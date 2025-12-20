import { describe, expect, it } from "vitest";
import { syncItemProjections } from "../../convex/lib/itemProjections";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { MutationCtx } from "../../convex/_generated/server";
import type { ItemSpecV2 } from "../../convex/lib/zodSchemas";

type TableName =
    | "projectItems"
    | "itemRevisions"
    | "sections"
    | "materialLines"
    | "workLines"
    | "tasks"
    | "itemProjectionLocks";

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
        projectItems: [],
        itemRevisions: [],
        sections: [],
        materialLines: [],
        workLines: [],
        tasks: [],
        itemProjectionLocks: [],
    };
    private counters: Record<TableName, number> = {
        projectItems: 0,
        itemRevisions: 0,
        sections: 0,
        materialLines: 0,
        workLines: 0,
        tasks: 0,
        itemProjectionLocks: 0,
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

function createItemSpec(): ItemSpecV2 {
    return {
        version: "ItemSpecV2",
        identity: {
            title: "Main stage",
            typeKey: "build",
            accountingGroup: "Stage",
        },
        breakdown: {
            subtasks: [
                {
                    id: "S1",
                    title: "Build frame",
                },
            ],
            materials: [
                {
                    id: "M1",
                    label: "Plywood",
                    qty: 4,
                    unit: "sheet",
                    unitCostEstimate: 50,
                },
            ],
            labor: [
                {
                    id: "L1",
                    workType: "carpentry",
                    role: "Carpenter",
                    rateType: "day",
                    quantity: 2,
                    unitCost: 450,
                },
            ],
        },
        state: { openQuestions: [], assumptions: [], decisions: [] },
        quote: { includeInQuote: true },
    };
}

function createBaseItem(projectId: Id<"projects">): Doc<"projectItems"> {
    return {
        _id: "item_1" as Id<"projectItems">,
        projectId,
        title: "Main stage",
        typeKey: "build",
        status: "approved",
        createdFrom: { source: "manual" },
        latestRevisionNumber: 1,
        createdAt: 0,
        updatedAt: 0,
    };
}

function createRevision(projectId: Id<"projects">, itemId: Id<"projectItems">, spec: ItemSpecV2): Doc<"itemRevisions"> {
    return {
        _id: "rev_1" as Id<"itemRevisions">,
        projectId,
        itemId,
        tabScope: "clarification",
        state: "approved",
        revisionNumber: 1,
        data: spec,
        createdBy: { kind: "user" },
        createdAt: 0,
    };
}

describe("syncItemProjections", () => {
    it("creates section, lines, and tasks for a new item", async () => {
        const db = new FakeDb();
        const ctx = { db } as unknown as MutationCtx;
        const projectId = "project_1" as Id<"projects">;
        const item = createBaseItem(projectId);
        const spec = createItemSpec();
        const revision = createRevision(projectId, item._id, spec);

        const result = await syncItemProjections(ctx, { item, revision, spec });
        expect(result.skipped).toBe(false);

        const sections = db.getTable("sections");
        expect(sections).toHaveLength(1);
        expect(sections[0].itemId).toBe(item._id);
        expect(sections[0].name).toBe("Main stage");
        expect(sections[0].group).toBe("Stage");

        const materials = db.getTable("materialLines");
        expect(materials).toHaveLength(1);
        expect(materials[0].itemId).toBe(item._id);
        expect(materials[0].itemMaterialId).toBe("M1");
        expect(materials[0].label).toBe("Plywood");

        const workLines = db.getTable("workLines");
        expect(workLines).toHaveLength(1);
        expect(workLines[0].itemId).toBe(item._id);
        expect(workLines[0].itemLaborId).toBe("L1");
        expect(workLines[0].role).toBe("Carpenter");

        const tasks = db.getTable("tasks");
        expect(tasks).toHaveLength(1);
        expect(tasks[0].itemId).toBe(item._id);
        expect(tasks[0].itemSubtaskId).toBe("S1");
        expect(tasks[0].title).toBe("Build frame");
    });

    it("preserves actual fields and manual task status when patch does not override", async () => {
        const db = new FakeDb();
        const ctx = { db } as unknown as MutationCtx;
        const projectId = "project_1" as Id<"projects">;
        const item = createBaseItem(projectId);
        const spec = createItemSpec();
        const revision = createRevision(projectId, item._id, spec);

        const sectionId = db.insert("sections", {
            _id: "section_1",
            projectId,
            itemId: item._id,
            group: "Stage",
            name: "Main stage",
            sortOrder: 1,
            pricingMode: "estimated",
        }) as Id<"sections">;

        db.insert("materialLines", {
            _id: "material_1",
            projectId,
            sectionId,
            itemId: item._id,
            itemMaterialId: "M1",
            category: "General",
            label: "Old plywood",
            unit: "sheet",
            plannedQuantity: 2,
            plannedUnitCost: 40,
            actualQuantity: 10,
            actualUnitCost: 55,
            status: "planned",
        });

        db.insert("tasks", {
            _id: "task_1",
            projectId,
            title: "Build frame",
            status: "done",
            category: "Studio",
            priority: "Medium",
            itemId: item._id,
            itemSubtaskId: "S1",
            createdAt: 0,
            updatedAt: 0,
        });

        await syncItemProjections(ctx, { item, revision, spec });

        const materials = db.getTable("materialLines");
        const material = materials[0];
        expect(material.label).toBe("Plywood");
        expect(material.actualQuantity).toBe(10);
        expect(material.actualUnitCost).toBe(55);

        const tasks = db.getTable("tasks");
        expect(tasks[0].status).toBe("done");
    });
});
