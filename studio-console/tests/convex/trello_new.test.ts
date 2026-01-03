
import { describe, it, expect, vi } from "vitest";
import { generateTrelloPlan } from "../../convex/trello"; // Function to be implemented

const mockCtx = {
    runAction: vi.fn(), // Mock the skill call
};

describe("Trello Sync Module", () => {
    
    it("should generate a plan with Add Card operations for new tasks", async () => {
        // Mock the translator skill output
        mockCtx.runAction.mockResolvedValueOnce({
            operations: [
                { op: "createCard", taskId: "t1", listId: "l1", title: "Task 1" }
            ]
        });

        const tasks = [{ _id: "t1", title: "Task 1", status: "open" }];
        const trelloState = { lists: [{ id: "l1", name: "To Do" }], cards: [] };

        const plan = await generateTrelloPlan(mockCtx as any, { tasks, trelloState });

        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0].op).toBe("createCard");
        expect(plan.operations[0].title).toBe("Task 1");
    });

    it("should generate Update operations for changed tasks", async () => {
        // Mock translator output
        mockCtx.runAction.mockResolvedValueOnce({
             operations: [
                { op: "updateCard", cardId: "c1", taskId: "t1", title: "Task 1 Changed" }
            ]
        });

        const tasks = [{ _id: "t1", title: "Task 1 Changed", status: "open" }];
        const trelloState = { 
            lists: [{ id: "l1", name: "To Do" }], 
            cards: [{ id: "c1", name: "Task 1 Original", desc: "mapped:t1" }] 
        };

        const plan = await generateTrelloPlan(mockCtx as any, { tasks, trelloState });
        
        expect(plan.operations[0].op).toBe("updateCard");
        expect(plan.operations[0].title).toBe("Task 1 Changed");
    });

    it("should be idempotent (no ops if nothing changed)", async () => {
        mockCtx.runAction.mockResolvedValueOnce({ operations: [] });

        const tasks = [{ _id: "t1", title: "Task 1", status: "open" }];
        const trelloState = { 
            lists: [{ id: "l1", name: "To Do" }], 
            cards: [{ id: "c1", name: "Task 1", desc: "mapped:t1" }] 
        };

        const plan = await generateTrelloPlan(mockCtx as any, { tasks, trelloState });
        expect(plan.operations).toHaveLength(0);
    });
});
