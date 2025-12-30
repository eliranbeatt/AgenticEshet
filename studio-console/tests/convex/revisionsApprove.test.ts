import { describe, expect, it } from "vitest";
import { approve } from "../../convex/revisions";
import { rebuild } from "../../convex/projections";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { ElementSnapshot } from "../../convex/lib/zodSchemas";
import type { MutationCtx } from "../../convex/_generated/server";

type TableName =
    | "projects"
    | "projectItems"
    | "revisions"
    | "revisionChanges"
    | "elementVersions"
    | "sections"
    | "materialLines"
    | "workLines"
    | "tasks"
    | "derivationRuns";

type Filter = { field: string; value: unknown };

class FakeQuery {
    private filters: Filter[];

    constructor(
        private db: FakeDb,
        private table: TableName,
        filters: Filter[] = [],
    ) {
        this.filters = filters;
    }

    withIndex(_name: string, callback: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
        const nextFilters = [...this.filters];
        const builder = {
            eq: (field: string, value: unknown) => {
                nextFilters.push({ field, value });
                return builder;
            },
        };
        callback(builder);
        return new FakeQuery(this.db, this.table, nextFilters);
    }

    collect() {
        return this.db
            .getTable(this.table)
            .filter((doc) => this.filters.every((f) => doc[f.field] === f.value));
    }

    unique() {
        const rows = this.collect();
        return rows.length > 0 ? rows[0] : null;
    }
}

class FakeDb {
    private tables: Record<TableName, Record<string, unknown>[]> = {
        projects: [],
        projectItems: [],
        revisions: [],
        revisionChanges: [],
        elementVersions: [],
        sections: [],
        materialLines: [],
        workLines: [],
        tasks: [],
        derivationRuns: [],
    };
    private counters: Record<TableName, number> = {
        projects: 0,
        projectItems: 0,
        revisions: 0,
        revisionChanges: 0,
        elementVersions: 0,
        sections: 0,
        materialLines: 0,
        workLines: 0,
        tasks: 0,
        derivationRuns: 0,
    };

    query(table: TableName) {
        return new FakeQuery(this, table);
    }

    insert(table: TableName, doc: Record<string, unknown>) {
        const nextId = `${table}_${++this.counters[table]}`;
        const record = { ...doc, _id: doc._id ?? nextId };
        this.tables[table].push(record);
        return record._id;
    }

    patch(id: string, updates: Record<string, unknown>) {
        const record = this.findById(id);
        if (!record) throw new Error(`Missing record ${id}`);
        Object.assign(record, updates);
    }

    delete(id: string) {
        for (const table of Object.values(this.tables)) {
            const index = table.findIndex((row) => row._id === id);
            if (index >= 0) {
                table.splice(index, 1);
                return;
            }
        }
    }

    get(id: string) {
        return this.findById(id);
    }

    getTable(table: TableName) {
        return this.tables[table];
    }

    private findById(id: string) {
        for (const table of Object.values(this.tables)) {
            const match = table.find((row) => row._id === id);
            if (match) return match;
        }
        return null;
    }
}

function getHandler<T>(fn: T): T extends { handler: infer H } ? H : T {
    const asAny = fn as unknown as { handler?: unknown };
    if (typeof asAny.handler === "function") return asAny.handler as never;
    return fn as never;
}

function buildSnapshot(): ElementSnapshot {
    return {
        schemaVersion: "element-snapshot/v1",
        descriptions: { short: "Display wall", long: "" },
        freeText: {
            preferences: "",
            risks: "",
            openQuestions: "",
            installation: "",
            building: "",
            constraints: "",
            notes: "",
        },
        materials: [
            {
                materialKey: "mat_deadbeef",
                name: "Plywood",
                spec: "18mm",
                qty: 4,
                unit: "sheet",
                unitCost: 50,
                totalCost: undefined,
                bucketKey: "materials",
                needPurchase: true,
                vendorRef: undefined,
                notes: undefined,
            },
        ],
        labor: [
            {
                laborKey: "lab_deadbeef",
                role: "Carpenter",
                qty: 2,
                unit: "day",
                rate: 450,
                bucketKey: "carpentry",
                notes: undefined,
            },
        ],
        tasks: [
            {
                taskKey: "tsk_deadbeef",
                title: "Buy plywood",
                details: "Purchase sheets",
                bucketKey: "procurement",
                taskType: "purchase_material",
                estimate: "2h",
                dependencies: [],
                usesMaterialKeys: ["mat_deadbeef"],
                usesLaborKeys: [],
                materialKey: "mat_deadbeef",
            },
        ],
        tombstones: { taskKeys: [], materialKeys: [], laborKeys: [] },
    };
}

describe("revisions.approve", () => {
    it("creates element version and projections from draft snapshot", async () => {
        const db = new FakeDb();
        const ctx = {
            db,
            runMutation: async (_mutation: unknown, args: { projectId: Id<"projects"> }) => {
                const handler = getHandler(rebuild);
                return await (handler as unknown as (ctx: MutationCtx, args: { projectId: Id<"projects"> }) => Promise<unknown>)(ctx as MutationCtx, args);
            },
        } as unknown as MutationCtx & { runMutation: MutationCtx["runMutation"] };

        const projectId = "project_1" as Id<"projects">;
        db.insert("projects", { _id: projectId, name: "Test Project" });

        const baseSnapshot = buildSnapshot();
        baseSnapshot.materials[0]!.name = "Legacy";
        const baseVersionId = db.insert("elementVersions", {
            projectId,
            elementId: "item_1",
            createdAt: 0,
            createdBy: "seed",
            snapshot: baseSnapshot,
        }) as Id<"elementVersions">;

        const elementId = db.insert("projectItems", {
            _id: "item_1",
            projectId,
            title: "Display wall",
            typeKey: "build",
            status: "approved",
            elementStatus: "active",
            activeVersionId: baseVersionId,
            createdFrom: { source: "manual" },
            latestRevisionNumber: 1,
            createdAt: 0,
            updatedAt: 0,
        }) as Id<"projectItems">;

        const revisionId = db.insert("revisions", {
            projectId,
            status: "draft",
            originTab: "Tasks",
            actionType: "manual_edit",
            summary: "Update element snapshot",
            tags: [],
            affectedElementIds: [elementId],
            createdAt: Date.now(),
            createdBy: "user",
        }) as Id<"revisions">;

        db.insert("revisionChanges", {
            revisionId,
            elementId,
            baseVersionId,
            replaceMask: ["tasks", "materials", "labor"],
            proposedSnapshot: buildSnapshot(),
        });

        const approveHandler = getHandler(approve) as unknown as (
            ctx: MutationCtx,
            args: { revisionId: Id<"revisions">; approvedBy?: string },
        ) => Promise<void>;

        await approveHandler(ctx as MutationCtx, { revisionId, approvedBy: "tester" });

        const versions = db.getTable("elementVersions");
        expect(versions).toHaveLength(2);

        const updatedElement = db.get(elementId) as Doc<"projectItems">;
        expect(updatedElement.activeVersionId).not.toBe(baseVersionId);

        const tasks = db.getTable("tasks");
        const materials = db.getTable("materialLines");
        const workLines = db.getTable("workLines");
        expect(tasks).toHaveLength(1);
        expect(materials).toHaveLength(1);
        expect(workLines).toHaveLength(1);

        const task = tasks[0] as Doc<"tasks">;
        const material = materials[0] as Doc<"materialLines">;
        expect(task.accountingLineId).toBe(material._id);
        expect(material.taskId).toBe(task._id);

        const revision = db.get(revisionId) as Doc<"revisions">;
        expect(revision.status).toBe("approved");
    });

    it("rejects approval when base version conflicts", async () => {
        const db = new FakeDb();
        const ctx = {
            db,
            runMutation: async (_mutation: unknown, args: { projectId: Id<"projects"> }) => {
                const handler = getHandler(rebuild);
                return await (handler as unknown as (ctx: MutationCtx, args: { projectId: Id<"projects"> }) => Promise<unknown>)(ctx as MutationCtx, args);
            },
        } as unknown as MutationCtx & { runMutation: MutationCtx["runMutation"] };

        const projectId = "project_2" as Id<"projects">;
        db.insert("projects", { _id: projectId, name: "Conflict Project" });

        const baseVersionId = db.insert("elementVersions", {
            projectId,
            elementId: "item_2",
            createdAt: 0,
            createdBy: "seed",
            snapshot: buildSnapshot(),
        }) as Id<"elementVersions">;

        const currentVersionId = db.insert("elementVersions", {
            projectId,
            elementId: "item_2",
            createdAt: 1,
            createdBy: "seed",
            snapshot: buildSnapshot(),
        }) as Id<"elementVersions">;

        const elementId = db.insert("projectItems", {
            _id: "item_2",
            projectId,
            title: "Wall",
            typeKey: "build",
            status: "approved",
            elementStatus: "active",
            activeVersionId: currentVersionId,
            createdFrom: { source: "manual" },
            latestRevisionNumber: 1,
            createdAt: 0,
            updatedAt: 0,
        }) as Id<"projectItems">;

        const revisionId = db.insert("revisions", {
            projectId,
            status: "draft",
            originTab: "Tasks",
            actionType: "manual_edit",
            summary: "Conflicting update",
            tags: [],
            affectedElementIds: [elementId],
            createdAt: Date.now(),
            createdBy: "user",
        }) as Id<"revisions">;

        db.insert("revisionChanges", {
            revisionId,
            elementId,
            baseVersionId,
            replaceMask: ["tasks"],
            proposedSnapshot: buildSnapshot(),
        });

        const approveHandler = getHandler(approve) as unknown as (
            ctx: MutationCtx,
            args: { revisionId: Id<"revisions">; approvedBy?: string },
        ) => Promise<void>;

        await expect(approveHandler(ctx as MutationCtx, { revisionId, approvedBy: "tester" }))
            .rejects.toThrow(/Conflict detected/);
    });
});
