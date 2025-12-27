import { describe, expect, it } from "vitest";
import { buildDerivedCurrentState } from "../../convex/lib/currentState";

describe("buildDerivedCurrentState", () => {
    it("renders project and item blocks", () => {
        const markdown = buildDerivedCurrentState({
            projectName: "Test Project",
            items: [
                {
                    id: "item_1",
                    title: "Hero Wall",
                    typeKey: "set_piece",
                    status: "approved",
                    scope: { dimensions: "3m x 2m", quantity: 1, unit: "pcs" },
                },
            ],
            knowledgeBlocks: [
                {
                    scopeType: "project",
                    blockKey: "project.summary",
                    renderedMarkdown: "### project.summary\n\n- **goal**: launch",
                },
                {
                    scopeType: "item",
                    itemId: "item_1",
                    blockKey: "item.dimensions",
                    renderedMarkdown: "### item.dimensions\n\n- **width**: 3m",
                },
            ],
        });

        expect(markdown).toContain("# Current State (Derived)");
        expect(markdown).toContain("## Project Facts");
        expect(markdown).toContain("### Item: Hero Wall");
        expect(markdown).toContain("### item.dimensions");
    });
});
