import { describe, expect, it } from "vitest";
import { buildCardPayload, deriveListId } from "../../convex/trelloSync";

const listMap = {
    todo: "list-todo",
    in_progress: "list-progress",
    blocked: "list-blocked",
    done: "list-done",
};

const baseTask = {
    title: "Book venue",
    category: "Logistics" as "Logistics" | "Creative" | "Finance" | "Admin" | "Studio",
    description: "Confirm availability and hold dates.",
    priority: "High" as const,
    status: "todo" as const,
};

describe("deriveListId", () => {
    it("returns matching list id when mapping exists", () => {
        expect(deriveListId("in_progress", listMap)).toBe("list-progress");
    });

    it("falls back to todo mapping for unknown statuses", () => {
        expect(deriveListId("unknown" as never, listMap)).toBe("list-todo");
    });
});

describe("buildCardPayload", () => {
    it("includes category, description, and priority when building payload", () => {
        const payload = buildCardPayload(baseTask, "list-todo");
        expect(payload.name).toBe("[Logistics] Book venue");
        expect(payload.desc).toContain("Confirm availability");
        expect(payload.desc).toContain("Priority: High");
        expect(payload.closed).toBe("false");
    });

    it("marks card as closed when task is done and omits empty description", () => {
        const payload = buildCardPayload(
            { ...baseTask, status: "done", description: "", category: "Logistics" as const },
            "list-done"
        );
        expect(payload.closed).toBe("true");
        expect(payload.desc).not.toContain("Description");
    });
});
