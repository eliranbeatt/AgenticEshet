// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { queueTaskGeneration } from "../lib/architectTaskGeneration";
import type { Id } from "../_generated/dataModel";

describe("architect agent task generation", () => {
    it("fails fast when no active plan exists", async () => {
        const ctx = {
            runQuery: vi.fn().mockResolvedValue({ latestPlan: null }),
            runMutation: vi.fn(),
            scheduler: { runAfter: vi.fn() },
        };

        await expect(queueTaskGeneration(ctx, "proj" as unknown as Id<"projects">)).rejects.toThrow(
            "No active plan found. Approve a plan before generating tasks."
        );
        expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    });

    it("queues background generation when an active plan exists", async () => {
        const ctx = {
            runQuery: vi.fn().mockResolvedValue({ latestPlan: { _id: "plan", contentMarkdown: "x" } }),
            runMutation: vi.fn().mockResolvedValue("run_1"),
            scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
        };

        await expect(queueTaskGeneration(ctx, "proj" as unknown as Id<"projects">)).resolves.toEqual({ queued: true, runId: "run_1" });
        expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(1);
    });
});
