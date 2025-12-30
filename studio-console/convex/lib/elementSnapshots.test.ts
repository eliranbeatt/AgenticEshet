import { describe, expect, it } from "vitest";
import { applyPatchOps } from "./elementSnapshots";
import type { ElementSnapshot } from "./zodSchemas";

function buildBaseSnapshot(): ElementSnapshot {
    return {
        schemaVersion: "element-snapshot/v1",
        descriptions: { short: "", long: "" },
        freeText: {
            preferences: "",
            risks: "",
            openQuestions: "",
            installation: "",
            building: "",
            constraints: "",
            notes: "",
        },
        materials: [],
        labor: [],
        tasks: [],
        tombstones: { taskKeys: [], materialKeys: [], laborKeys: [] },
    };
}

describe("applyPatchOps", () => {
    it("prevents re-adding tombstoned keys without restore", () => {
        const base = buildBaseSnapshot();
        const tombstoned = applyPatchOps(base, [
            { op: "remove_line", entity: "tasks", key: "tsk_deadbeef" },
        ]);

        expect(tombstoned.tombstones.taskKeys).toContain("tsk_deadbeef");

        expect(() =>
            applyPatchOps(tombstoned, [
                {
                    op: "upsert_line",
                    entity: "tasks",
                    key: "tsk_deadbeef",
                    value: {
                        taskKey: "tsk_deadbeef",
                        title: "Re-add",
                        details: "Details",
                        bucketKey: "general",
                        taskType: "normal",
                        dependencies: [],
                        usesMaterialKeys: [],
                        usesLaborKeys: [],
                    },
                },
            ]),
        ).toThrow(/tombstoned/);

        const restored = applyPatchOps(tombstoned, [
            { op: "tombstone_restore", entity: "tasks", key: "tsk_deadbeef" },
            {
                op: "upsert_line",
                entity: "tasks",
                key: "tsk_deadbeef",
                value: {
                    taskKey: "tsk_deadbeef",
                    title: "Re-add",
                    details: "Details",
                    bucketKey: "general",
                    taskType: "normal",
                    dependencies: [],
                    usesMaterialKeys: [],
                    usesLaborKeys: [],
                },
            },
        ]);

        expect(restored.tasks).toHaveLength(1);
        expect(restored.tombstones.taskKeys).not.toContain("tsk_deadbeef");
    });

    it("removes purchase task and clears material purchase flag", () => {
        const base = buildBaseSnapshot();
        base.materials = [
            {
                materialKey: "mat_deadbeef",
                name: "Lumber",
                spec: "",
                qty: 5,
                unit: "unit",
                unitCost: 10,
                totalCost: 50,
                bucketKey: "materials",
                needPurchase: true,
                vendorRef: undefined,
                notes: undefined,
            },
        ];
        base.tasks = [
            {
                taskKey: "tsk_deadbeef",
                title: "Buy lumber",
                details: "",
                bucketKey: "procurement",
                taskType: "purchase_material",
                estimate: "60m",
                dependencies: [],
                usesMaterialKeys: ["mat_deadbeef"],
                usesLaborKeys: [],
                materialKey: "mat_deadbeef",
            },
            {
                taskKey: "tsk_feedcafe",
                title: "Install lumber",
                details: "",
                bucketKey: "install",
                taskType: "install",
                estimate: "120m",
                dependencies: ["tsk_deadbeef"],
                usesMaterialKeys: ["mat_deadbeef"],
                usesLaborKeys: [],
                materialKey: undefined,
            },
        ];

        const next = applyPatchOps(base, [
            { op: "remove_line", entity: "tasks", key: "tsk_deadbeef" },
        ]);

        expect(next.tasks.find((task) => task.taskKey === "tsk_deadbeef")).toBeUndefined();
        expect(next.tombstones.taskKeys).toContain("tsk_deadbeef");
        expect(next.materials[0]?.needPurchase).toBe(false);
        expect(next.tasks[0]?.dependencies).not.toContain("tsk_deadbeef");
    });

    it("auto-deletes empty tasks and tombstones them", () => {
        const base = buildBaseSnapshot();
        const next = applyPatchOps(base, [
            {
                op: "upsert_line",
                entity: "tasks",
                key: "tsk_deadbeef",
                value: {
                    taskKey: "tsk_deadbeef",
                    title: " ",
                    details: "",
                    bucketKey: "general",
                    taskType: "normal",
                    dependencies: [],
                    usesMaterialKeys: [],
                    usesLaborKeys: [],
                },
            },
        ]);

        expect(next.tasks).toHaveLength(0);
        expect(next.tombstones.taskKeys).toContain("tsk_deadbeef");
    });
});
