
import { describe, it, expect, vi } from "vitest";
import { runSkill } from "../../convex/lib/skills"; 

// Mock dependencies
const mockCtx = {
  runQuery: vi.fn(),
  runAction: vi.fn(),
  db: { query: () => ({ withIndex: () => ({ first: () => null }) }) } // Deep mock if needed
};

describe("Skills Registry", () => {
    
  it("should validate input against schema", async () => {
    // Mock loading skill definition
    mockCtx.runQuery.mockResolvedValueOnce({
        key: "test.skill",
        name: "Test Skill",
        inputSchema: JSON.stringify({
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } }
        }),
        outputSchema: "{}"
    });

    // Valid input
    await expect(runSkill(mockCtx as any, {
        skillKey: "test.skill",
        input: { text: "hello" }
    })).resolves.not.toThrow();

    // Invalid input
    mockCtx.runQuery.mockResolvedValueOnce({
        key: "test.skill",
        inputSchema: JSON.stringify({
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } }
        }),
        outputSchema: "{}"
    });
    
    await expect(runSkill(mockCtx as any, {
        skillKey: "test.skill",
        input: { missing: "text" }
    })).rejects.toThrow(/Validation Error/);
  });
});
