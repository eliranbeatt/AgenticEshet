// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildTrelloSyncPlanSchema } from "../../convex/agents/trelloSyncAgent";

describe("buildTrelloSyncPlanSchema", () => {
    it("normalizes planVersion, context, and op fields", () => {
        const schema = buildTrelloSyncPlanSchema("proj-123");

        const input = {
            planVersion: 1,
            operations: [
                { opId: "op1", type: "ENSURE_LIST", boardId: "b1", list: { name: "todo" } },
                { opId: "op2", operation: "ENSURE_LABEL", boardId: "b1", label: { name: "Urgent" } },
                { opId: "op3", action: "SKIP", reason: "No changes" },
            ],
        };

        const output = schema.parse(input);

        expect(output.planVersion).toBe("1.0");
        expect(output.context.projectId).toBe("proj-123");
        expect(output.operations[0].op).toBe("ENSURE_LIST");
        expect(output.operations[1].op).toBe("ENSURE_LABEL");
        expect(output.operations[2].op).toBe("SKIP");
    });
});
