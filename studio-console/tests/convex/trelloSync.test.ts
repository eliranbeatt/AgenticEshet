import { describe, expect, it, vi, beforeEach } from "vitest";
import { executeTrelloSyncPlan } from "../../convex/lib/trelloExecutor";
import type { TrelloSyncPlan } from "../../convex/lib/trelloTypes";

describe("executeTrelloSyncPlan", () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        mockFetch.mockReset();
    });

    const config = {
        apiKey: "test-key",
        token: "test-token",
        fetchImpl: mockFetch as any,
    };

    it("executes UPSERT_CARD by creating a new card", async () => {
        // Setup mock response for POST /cards
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ id: "new-card-id" }),
            headers: new Headers({ "content-type": "application/json" }),
        });
        // Setup mock response for subsequent GET /cards/... (idempotency check)
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ idLabels: [], idMembers: [] }),
            headers: new Headers({ "content-type": "application/json" }),
        });

        const plan: TrelloSyncPlan = {
            planVersion: "1.0",
            context: { projectId: "p1" },
            operations: [
                {
                    opId: "op1",
                    op: "UPSERT_CARD",
                    taskId: "t1",
                    boardId: "board-1",
                    listId: "list-1",
                    card: { name: "Test Task" },
                    mode: "create_or_update",
                    setVar: "card.t1",
                    contentHash: "hash1"
                },
            ],
        };

        const report = await executeTrelloSyncPlan(plan, config);

        expect(report.opResults[0].ok).toBe(true);
        expect(report.opResults[0].created?.id).toBe("new-card-id");

        // Verify POST /cards call
        const call = mockFetch.mock.calls[0];
        expect(call[0]).toContain("https://api.trello.com/1/cards");
        expect(call[1].method).toBe("POST");
        const body = JSON.parse(call[1].body);
        expect(body.name).toBe("Test Task");
        expect(body.idList).toBe("list-1");
    });

    it("executes ENSURE_LIST by checking cache then creating", async () => {
        // 1. GET /boards/b1/lists -> empty array (list missing)
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify([]),
            headers: new Headers({ "content-type": "application/json" }),
        });
        
        // 2. POST /boards/b1/lists -> returns new list
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify({ id: "list-new", name: "To Do" }),
            headers: new Headers({ "content-type": "application/json" }),
        });

        const plan: TrelloSyncPlan = {
            planVersion: "1.0",
            context: { projectId: "p1" },
            operations: [
                {
                    opId: "op2",
                    op: "ENSURE_LIST",
                    boardId: "b1",
                    list: { name: "To Do" },
                    setVar: "list.todo",
                },
            ],
        };

        const report = await executeTrelloSyncPlan(plan, config);

        expect(report.opResults[0].ok).toBe(true);
        expect(report.opResults[0].producedVars?.["list.todo"]).toBe("list-new");

        // Verify GET lists
        expect(mockFetch.mock.calls[0][0]).toContain("/boards/b1/lists");
        
        // Verify POST lists
        expect(mockFetch.mock.calls[1][1].method).toBe("POST");
        expect(mockFetch.mock.calls[1][0]).toContain("/boards/b1/lists");
    });
});
