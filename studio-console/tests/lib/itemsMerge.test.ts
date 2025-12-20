import { describe, expect, it } from "vitest";
import { createEmptyItemSpec } from "../../lib/items";
import { mergeItemSpec } from "../../lib/itemsMerge";

describe("mergeItemSpec", () => {
    it("overrides identity fields and replaces state arrays", () => {
        const base = createEmptyItemSpec("Stage build", "build");
        base.identity.description = "Initial description";
        base.state.openQuestions = ["Q1"];

        const merged = mergeItemSpec(base, {
            identity: { title: "Updated title", tags: ["alpha"] },
            state: { openQuestions: ["Q2", "Q3"] },
        });

        expect(merged.identity.title).toBe("Updated title");
        expect(merged.identity.typeKey).toBe("build");
        expect(merged.identity.tags).toEqual(["alpha"]);
        expect(merged.state.openQuestions).toEqual(["Q2", "Q3"]);
        expect(merged.state.assumptions).toEqual([]);
    });

    it("merges materials by id and preserves existing entries", () => {
        const base = createEmptyItemSpec("Props", "material");
        base.breakdown.materials = [
            { id: "M1", label: "Plywood", qty: 2, unit: "sheet", unitCostEstimate: 40 },
            { id: "M2", label: "Paint", qty: 1, unit: "can", unitCostEstimate: 20 },
        ];

        const merged = mergeItemSpec(base, {
            breakdown: {
                materials: [
                    { id: "M1", qty: 5 },
                    { id: "M3", label: "Metal brackets", qty: 8, unit: "pcs", unitCostEstimate: 6 },
                ],
            },
        });

        expect(merged.breakdown.materials).toHaveLength(3);
        const plywood = merged.breakdown.materials.find((m) => m.id === "M1");
        const paint = merged.breakdown.materials.find((m) => m.id === "M2");
        const brackets = merged.breakdown.materials.find((m) => m.id === "M3");

        expect(plywood?.qty).toBe(5);
        expect(plywood?.label).toBe("Plywood");
        expect(paint?.label).toBe("Paint");
        expect(brackets?.label).toBe("Metal brackets");
    });

    it("merges nested subtasks by id", () => {
        const base = createEmptyItemSpec("Install", "task");
        base.breakdown.subtasks = [
            {
                id: "S1",
                title: "Build frame",
                children: [
                    { id: "S1-1", title: "Cut wood" },
                ],
            },
        ];

        const merged = mergeItemSpec(base, {
            breakdown: {
                subtasks: [
                    {
                        id: "S1",
                        title: "Build frame v2",
                        children: [
                            { id: "S1-1", estMinutes: 120 },
                            { id: "S1-2", title: "Assemble frame" },
                        ],
                    },
                ],
            },
        });

        const root = merged.breakdown.subtasks[0];
        expect(root.title).toBe("Build frame v2");
        expect(root.children).toHaveLength(2);
        const cut = root.children?.find((c) => c.id === "S1-1");
        const assemble = root.children?.find((c) => c.id === "S1-2");

        expect(cut?.title).toBe("Cut wood");
        expect(cut?.estMinutes).toBe(120);
        expect(assemble?.title).toBe("Assemble frame");
    });
});
