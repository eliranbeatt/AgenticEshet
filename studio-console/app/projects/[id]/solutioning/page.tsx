"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AgentChatThread } from "../_components/chat/AgentChatThread";
import { ImageGeneratorPanel } from "../_components/images/ImageGeneratorPanel";
import { ImagePicker } from "../_components/images/ImagePicker";
import { ItemsTreeSidebar } from "../_components/items/ItemsTreeSidebar";
import { ItemEditorPanel } from "../_components/items/ItemEditorPanel";
import { useItemsContext } from "../_components/items/ItemsContext";
import { ChangeSetReviewBanner } from "../_components/changesets/ChangeSetReviewBanner";

type PlanningItem = {
    _id: Id<"projectItems">;
    title: string;
    typeKey: string;
    status: "draft" | "approved" | "archived";
    description?: string;
    tags?: string[];
    planMarkdown?: string;
    planJson?: string;
    planState?: "draft" | "approved" | "none";
};

type SolutionItemPlanV1 = {
    version: "SolutionItemPlanV1";
    title: string;
    summary?: string;
    steps: Array<{
        id: string;
        title: string;
        details: string;
        estimatedMinutes?: number;
        materials?: string[];
        tools?: string[];
    }>;
};

function createEmptyPlan(title: string): SolutionItemPlanV1 {
    return {
        version: "SolutionItemPlanV1",
        title,
        summary: "",
        steps: [
            {
                id: "S1",
                title: "Step 1",
                details: "",
                estimatedMinutes: undefined,
                materials: [],
                tools: [],
            },
        ],
    };
}

function safeParsePlanJson(json: string | undefined | null, fallbackTitle: string): SolutionItemPlanV1 {
    if (!json) return createEmptyPlan(fallbackTitle);
    try {
        const parsed = JSON.parse(json) as Partial<SolutionItemPlanV1>;
        if (parsed.version !== "SolutionItemPlanV1" || !parsed.title || !Array.isArray(parsed.steps)) {
            return createEmptyPlan(fallbackTitle);
        }
        return {
            version: "SolutionItemPlanV1",
            title: parsed.title,
            summary: typeof parsed.summary === "string" ? parsed.summary : "",
            steps: parsed.steps.map((s, idx) => ({
                id: typeof s.id === "string" ? s.id : `S${idx + 1}`,
                title: typeof s.title === "string" ? s.title : `Step ${idx + 1}`,
                details: typeof s.details === "string" ? s.details : "",
                estimatedMinutes: typeof s.estimatedMinutes === "number" ? s.estimatedMinutes : undefined,
                materials: Array.isArray(s.materials) ? s.materials.filter((m) => typeof m === "string") : [],
                tools: Array.isArray(s.tools) ? s.tools.filter((t) => typeof t === "string") : [],
            })),
        };
    } catch {
        return createEmptyPlan(fallbackTitle);
    }
}

function renderPlanMarkdown(plan: SolutionItemPlanV1): string {
    const lines: string[] = [];
    lines.push(`# ${plan.title}`);
    if (plan.summary?.trim()) {
        lines.push("", plan.summary.trim());
    }
    lines.push("", "## Steps");
    for (const step of plan.steps) {
        lines.push("", `### ${step.title}`);
        if (step.details.trim()) lines.push(step.details.trim());
        if (typeof step.estimatedMinutes === "number") {
            lines.push("", `- Est. minutes: ${step.estimatedMinutes}`);
        }
        if (step.materials && step.materials.length) {
            lines.push("", `- Materials: ${step.materials.join(", ")}`);
        }
        if (step.tools && step.tools.length) {
            lines.push("", `- Tools: ${step.tools.join(", ")}`);
        }
    }
    return lines.join("\n");
}

export default function SolutioningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const { selectedItemId } = useItemsContext();

    const items = useQuery(api.agents.solutioning.getPlanningItems, { projectId });
    const ensureThread = useMutation(api.chat.ensureThread);
    const sendMessage = useAction(api.agents.solutioningV2.send);
    const updateSolutionMutation = useMutation(api.agents.solutioning.updateSolution);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);
    const [scenarioId, setScenarioId] = useState<Id<"projectScenarios"> | null>(null);

    const [planDraft, setPlanDraft] = useState<SolutionItemPlanV1 | null>(null);
    const [markdownDraft, setMarkdownDraft] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const previousSelectedItemIdRef = useRef<string | null>(null);
    const lastRemotePlanJsonRef = useRef<string | null>(null);
    const lastRemoteMarkdownRef = useRef<string | null>(null);

    useEffect(() => {
        if (!selectedItemId) return;
        if (!items) return;

        const selectedItemIdString = String(selectedItemId);
        const item = items.find((i) => i._id === selectedItemId) ?? null;
        const title = item ? `${item.title} (${item.typeKey})` : "Solution Plan";
        const remotePlanJson = item?.planJson ?? null;
        const remoteMarkdown = item?.planMarkdown || "";

        const isSameItem = previousSelectedItemIdRef.current === selectedItemIdString;
        if (!isSameItem) {
            previousSelectedItemIdRef.current = selectedItemIdString;
            setPlanDraft(safeParsePlanJson(remotePlanJson, title));
            setMarkdownDraft(remoteMarkdown);
            lastRemotePlanJsonRef.current = remotePlanJson;
            lastRemoteMarkdownRef.current = remoteMarkdown;

            void (async () => {
                const result = await ensureThread({
                    projectId,
                    phase: "solutioning",
                    scenarioKey: `item:${selectedItemIdString}`,
                    title: item?.title,
                });
                setThreadId(result.threadId);
                setScenarioId(result.scenarioId);
            })();
            return;
        }

        const lastRemotePlanJson = lastRemotePlanJsonRef.current;
        const lastRemoteMarkdown = lastRemoteMarkdownRef.current ?? "";
        const localPlanJson = planDraft ? JSON.stringify(planDraft) : null;
        const isPlanDirty = lastRemotePlanJson !== null && localPlanJson !== lastRemotePlanJson;
        const isMarkdownDirty = markdownDraft !== lastRemoteMarkdown;

        if (!isPlanDirty && !isMarkdownDirty) {
            if (remotePlanJson !== lastRemotePlanJson || remoteMarkdown !== lastRemoteMarkdown) {
                setPlanDraft(safeParsePlanJson(remotePlanJson, title));
                setMarkdownDraft(remoteMarkdown);
                lastRemotePlanJsonRef.current = remotePlanJson;
                lastRemoteMarkdownRef.current = remoteMarkdown;
            }
        }
    }, [ensureThread, items, projectId, selectedItemId, planDraft, markdownDraft]);

    useEffect(() => {
        if (!selectedItemId) return;
        window.localStorage.setItem(`solutioning:markdownDraft:${projectId}:${selectedItemId}`, markdownDraft);
    }, [markdownDraft, projectId, selectedItemId]);

    const selectedItem = useMemo<PlanningItem | null>(() => {
        if (!items || !selectedItemId) return null;
        return items.find((i) => i._id === selectedItemId) ?? null;
    }, [items, selectedItemId]);

    async function handleApplyPlan() {
        if (!selectedItemId) return;
        if (!planDraft) return;

        setIsSaving(true);
        try {
            const planJson = JSON.stringify(planDraft);
            const markdown = markdownDraft.trim() ? markdownDraft : renderPlanMarkdown(planDraft);
            await updateSolutionMutation({
                itemId: selectedItemId,
                solutionPlan: markdown,
                solutionPlanJson: planJson,
            });
            lastRemotePlanJsonRef.current = planJson;
            lastRemoteMarkdownRef.current = markdown;
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <ChangeSetReviewBanner projectId={projectId} phase="solutioning" />
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-semibold text-gray-900">Solutioning</h1>
                <div className="text-xs text-gray-500">Structured plans + images per item</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] h-[calc(100vh-180px)]">
                <ItemsTreeSidebar />

                <div className="grid gap-4 grid-cols-2 min-h-0">
                    <div className="flex flex-col gap-3 min-h-0">
                        {!selectedItemId || !threadId || !scenarioId ? (
                            <div className="bg-white border rounded p-4 text-sm text-gray-500">
                                Select an item to start solutioning.
                            </div>
                        ) : (
                            <AgentChatThread
                                threadId={threadId}
                                placeholder="Ask about build approach, materials, constraints..."
                                onSend={async (content) => {
                                    await sendMessage({
                                        threadId,
                                        itemId: selectedItemId,
                                        userContent: content,
                                    });
                                }}
                            />
                        )}
                    </div>

                    <div className="bg-white border rounded shadow-sm flex flex-col overflow-hidden min-h-0">
                        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
                            <div className="font-semibold text-sm text-gray-700">
                                {selectedItem ? selectedItem.title : "Selected item"}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                    disabled={!selectedItemId || !planDraft || isSaving}
                                    onClick={handleApplyPlan}
                                >
                                    {isSaving ? "Applying..." : "Apply"}
                                </button>
                            </div>
                        </div>

                        {!selectedItem || !planDraft ? (
                            <div className="p-4 text-sm text-gray-500">Select an item to edit its plan.</div>
                        ) : (
                            <div className="flex-1 min-h-0 grid grid-rows-[1fr_1fr] gap-4 p-4">
                                <div className="overflow-y-auto space-y-6 pr-1">
                                    <div className="space-y-2">
                                        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                            Structured plan
                                        </div>
                                        <input
                                            className="w-full border rounded px-3 py-2 text-sm"
                                            value={planDraft.title}
                                            onChange={(e) => setPlanDraft({ ...planDraft, title: e.target.value })}
                                        />
                                        <textarea
                                            className="w-full border rounded px-3 py-2 text-sm resize-none min-h-[70px]"
                                            placeholder="Summary (optional)"
                                            value={planDraft.summary ?? ""}
                                            onChange={(e) => setPlanDraft({ ...planDraft, summary: e.target.value })}
                                        />

                                        <div className="space-y-3">
                                            {planDraft.steps.map((step, idx) => (
                                                <div key={step.id} className="border rounded p-3 space-y-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="text-xs font-semibold text-gray-700">
                                                            Step {idx + 1}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                                                            disabled={planDraft.steps.length <= 1}
                                                            onClick={() => {
                                                                const next = planDraft.steps.filter((s) => s.id !== step.id);
                                                                setPlanDraft({ ...planDraft, steps: next });
                                                            }}
                                                        >
                                                            Remove
                                                        </button>
                                                    </div>
                                                    <input
                                                        className="w-full border rounded px-3 py-2 text-sm"
                                                        placeholder="Step title"
                                                        value={step.title}
                                                        onChange={(e) => {
                                                            const next = planDraft.steps.map((s) =>
                                                                s.id === step.id ? { ...s, title: e.target.value } : s
                                                            );
                                                            setPlanDraft({ ...planDraft, steps: next });
                                                        }}
                                                    />
                                                    <textarea
                                                        className="w-full border rounded px-3 py-2 text-sm resize-none min-h-[70px]"
                                                        placeholder="Details"
                                                        value={step.details}
                                                        onChange={(e) => {
                                                            const next = planDraft.steps.map((s) =>
                                                                s.id === step.id ? { ...s, details: e.target.value } : s
                                                            );
                                                            setPlanDraft({ ...planDraft, steps: next });
                                                        }}
                                                    />
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input
                                                            className="border rounded px-3 py-2 text-sm"
                                                            placeholder="Materials (comma separated)"
                                                            value={(step.materials ?? []).join(", ")}
                                                            onChange={(e) => {
                                                                const materials = e.target.value
                                                                    .split(",")
                                                                    .map((m) => m.trim())
                                                                    .filter(Boolean);
                                                                const next = planDraft.steps.map((s) =>
                                                                    s.id === step.id ? { ...s, materials } : s
                                                                );
                                                                setPlanDraft({ ...planDraft, steps: next });
                                                            }}
                                                        />
                                                        <input
                                                            className="border rounded px-3 py-2 text-sm"
                                                            placeholder="Tools (comma separated)"
                                                            value={(step.tools ?? []).join(", ")}
                                                            onChange={(e) => {
                                                                const tools = e.target.value
                                                                    .split(",")
                                                                    .map((t) => t.trim())
                                                                    .filter(Boolean);
                                                                const next = planDraft.steps.map((s) =>
                                                                    s.id === step.id ? { ...s, tools } : s
                                                                );
                                                                setPlanDraft({ ...planDraft, steps: next });
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                className="w-full text-sm px-3 py-2 rounded border bg-white hover:bg-gray-50"
                                                onClick={() => {
                                                    const nextId = `S${planDraft.steps.length + 1}`;
                                                    setPlanDraft({
                                                        ...planDraft,
                                                        steps: [
                                                            ...planDraft.steps,
                                                            { id: nextId, title: `Step ${planDraft.steps.length + 1}`, details: "" },
                                                        ],
                                                    });
                                                }}
                                            >
                                                Add step
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                            Markdown (optional)
                                        </div>
                                        <textarea
                                            className="w-full border rounded px-3 py-2 text-sm font-mono resize-none min-h-[160px]"
                                            placeholder="If empty, Apply will generate Markdown from the structured plan."
                                            value={markdownDraft}
                                            onChange={(e) => setMarkdownDraft(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="overflow-y-auto space-y-4 pr-1">
                                    <ImageGeneratorPanel
                                        projectId={projectId}
                                        entityType="projectItem"
                                        entityId={String(selectedItemId)}
                                        defaultPrompt={`${selectedItem.title} (${selectedItem.typeKey}) - studio build render`}
                                    />
                                    <ImagePicker
                                        projectId={projectId}
                                        entityType="projectItem"
                                        entityId={String(selectedItemId)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ItemEditorPanel />
        </div>
    );
}
