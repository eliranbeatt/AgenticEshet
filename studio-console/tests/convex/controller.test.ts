
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runControllerStepLogic } from "../../convex/agents/controller"; 
import { api } from "../../convex/_generated/api";

// Mock dependencies
const mockCtx = {
  runQuery: vi.fn(),
  runMutation: vi.fn(),
  runAction: vi.fn(),
};

describe("Controller Autonomous Loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should stop at Question Gate if critical info is missing", async () => {
    // Setup: Workspace has no brief
    mockCtx.runQuery.mockResolvedValueOnce({
      // projectWorkspaces data
      stagePinned: "ideation",
      facts: {}, // Empty facts
    });

    const result = await runControllerStepLogic(mockCtx as any, {
      projectId: "p1" as any,
      threadId: "t1" as any,
    });

    expect(result.status).toBe("STOP_QUESTIONS");
    expect(result.questions).toHaveLength(5);
  });

  it("should stop at Approval Gate if a ChangeSet is proposed", async () => {
    // Setup: Workspace has brief, Skill returns a ChangeSet
    mockCtx.runQuery.mockResolvedValueOnce({
        stagePinned: "ideation",
        facts: { brief: "Make a pop-up" },
    });
    
    // Mock Skill execution returning a ChangeSet
    mockCtx.runAction.mockResolvedValueOnce({
        pendingChangeSet: {
            summary: "Create Element X",
            patchOps: [{ op: "add", path: "/items", value: {} }]
        }
    });

    const result = await runControllerStepLogic(mockCtx as any, {
      projectId: "p1" as any,
      threadId: "t1" as any,
    });

    expect(result.status).toBe("STOP_APPROVAL");
    expect(result.changeSet).toBeDefined();
  });

  it("should continue to next skill if no gates are hit", async () => {
    // Setup: Workspace ok
    mockCtx.runQuery.mockResolvedValueOnce({
        stagePinned: "ideation",
        facts: { brief: "Make a pop-up" },
    });

    // Mock Skill execution returning artifacts (no ChangeSet)
    mockCtx.runAction.mockResolvedValueOnce({
        artifacts: { ideas: ["Idea 1"] },
        pendingChangeSet: null
    });

    const result = await runControllerStepLogic(mockCtx as any, {
        projectId: "p1" as any,
        threadId: "t1" as any,
    });

    // Should theoretically loop or return "CONTINUE"
    expect(result.status).toBe("CONTINUE");
    expect(mockCtx.runAction).toHaveBeenCalled(); 
  });
});
