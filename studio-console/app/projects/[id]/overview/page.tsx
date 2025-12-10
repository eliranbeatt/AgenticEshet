"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";

type DetailsFormState = {
    status: "lead" | "planning" | "production" | "archived";
    eventDate: string;
    budgetCap: string;
    location: string;
    notes: string;
};

const statusOptions: DetailsFormState["status"][] = ["lead", "planning", "production", "archived"];

export default function ProjectOverviewPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const project = useQuery(api.projects.getProject, { projectId });
    const tasks = useQuery(api.tasks.listByProject, { projectId });
    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const quests = useQuery(api.quests.list, { projectId });
    const questStats = useQuery(api.quests.getStats, { projectId });
    const clarificationHistory = useQuery(api.conversations.recentByPhase, {
        projectId,
        phase: "clarification",
        limit: 3,
    });
    const planningHistory = useQuery(api.conversations.recentByPhase, {
        projectId,
        phase: "planning",
        limit: 3,
    });
    const updateProject = useMutation(api.projects.updateProject);

    const [formState, setFormState] = useState<DetailsFormState>({
        status: "lead",
        eventDate: "",
        budgetCap: "",
        location: "",
        notes: "",
    });
    const [isSaving, setIsSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    useEffect(() => {
        if (project) {
            setFormState({
                status: project.status,
                eventDate: project.details.eventDate || "",
                budgetCap: project.details.budgetCap ? String(project.details.budgetCap) : "",
                location: project.details.location || "",
                notes: project.details.notes || "",
            });
        }
    }, [project]);

    const metrics = useMemo(() => {
        if (!tasks) {
            return { total: 0, todo: 0, inProgress: 0, done: 0 };
        }
        return {
            total: tasks.length,
            todo: tasks.filter((t) => t.status === "todo").length,
            inProgress: tasks.filter((t) => t.status === "in_progress").length,
            done: tasks.filter((t) => t.status === "done").length,
        };
    }, [tasks]);

    const questProgress = useMemo(() => {
        if (!quests || !questStats) return [];
        return quests.map((quest) => {
            const stat = questStats.find((s) => s.questId === quest._id);
            return {
                questId: quest._id,
                title: quest.title,
                percent: stat?.percent ?? 0,
                done: stat?.done ?? 0,
                total: stat?.total ?? 0,
            };
        });
    }, [quests, questStats]);

    if (project === undefined || tasks === undefined) {
        return <div>Loading overview...</div>;
    }

    if (!project) {
        return <div className="text-red-500">Project not found.</div>;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsSaving(true);
        setFormError(null);
        try {
            await updateProject({
                projectId,
                status: formState.status,
                details: {
                    eventDate: formState.eventDate || undefined,
                    budgetCap: formState.budgetCap ? Number(formState.budgetCap) : undefined,
                    location: formState.location || undefined,
                    notes: formState.notes || undefined,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to update project";
            setFormError(message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Summary + stats */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="col-span-1 xl:col-span-2 space-y-4">
                    <div className="bg-white p-6 rounded shadow-sm border">
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Latest Brief Summary</h2>
                        <p className="mt-3 text-gray-800 leading-relaxed">
                            {project.overviewSummary || "No AI summary available yet. Run the Clarification agent to generate one."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3 text-xs">
                            <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700">
                                Status: {project.status}
                            </span>
                            {planMeta?.activePlan ? (
                                <span className="px-3 py-1 rounded-full bg-green-100 text-green-800">
                                    Active Plan v{planMeta.activePlan.version}
                                </span>
                            ) : planMeta?.latestPlan?.isDraft ? (
                                <span className="px-3 py-1 rounded-full bg-yellow-100 text-yellow-800">Draft plan awaiting approval</span>
                            ) : null}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <MetricCard label="Total Tasks" value={metrics.total} accent="text-gray-800" />
                        <MetricCard label="To Do" value={metrics.todo} accent="text-amber-600" />
                        <MetricCard label="In Progress" value={metrics.inProgress} accent="text-blue-600" />
                        <MetricCard label="Done" value={metrics.done} accent="text-emerald-600" />
                    </div>

                    {questProgress.length > 0 && (
                        <QuestProgressChips quests={questProgress} />
                    )}
                </div>

                <div className="bg-white p-6 rounded shadow-sm border">
                    <h3 className="text-sm font-semibold uppercase text-gray-500 tracking-wide mb-4">Project Details</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                            <select
                                value={formState.status}
                                onChange={(e) => setFormState((prev) => ({ ...prev, status: e.target.value as DetailsFormState["status"] }))}
                                className="w-full border rounded px-3 py-2 text-sm"
                            >
                                {statusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {status}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Event Date</label>
                            <input
                                type="date"
                                value={formState.eventDate}
                                onChange={(e) => setFormState((prev) => ({ ...prev, eventDate: e.target.value }))}
                                className="w-full border rounded px-3 py-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Budget Cap</label>
                            <input
                                type="number"
                                min={0}
                                value={formState.budgetCap}
                                onChange={(e) => setFormState((prev) => ({ ...prev, budgetCap: e.target.value }))}
                                className="w-full border rounded px-3 py-2 text-sm"
                                placeholder="e.g. 25000"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
                            <input
                                type="text"
                                value={formState.location}
                                onChange={(e) => setFormState((prev) => ({ ...prev, location: e.target.value }))}
                                className="w-full border rounded px-3 py-2 text-sm"
                                placeholder="City / Venue"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                            <textarea
                                value={formState.notes}
                                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                                rows={3}
                                className="w-full border rounded px-3 py-2 text-sm"
                                placeholder="Additional constraints, contacts, etc."
                            />
                        </div>
                        {formError && <p className="text-xs text-red-600">{formError}</p>}
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium disabled:opacity-50"
                        >
                            {isSaving ? "Saving..." : "Save Updates"}
                        </button>
                    </form>
                </div>
            </div>

            {/* Conversation streams */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ConversationColumn
                    title="Recent Clarifications"
                    emptyText="Run the Clarification agent to capture discoveries."
                    conversations={clarificationHistory || []}
                />
                <ConversationColumn
                    title="Recent Planning Sessions"
                    emptyText="Generate a plan to see AI reasoning here."
                    conversations={planningHistory || []}
                />
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <QuickLink
                    href={`/projects/${projectId}/clarification`}
                    title="Clarification"
                    description="Refine the brief and requirements with AI."
                    accent="purple"
                />
                <QuickLink
                    href={`/projects/${projectId}/planning`}
                    title="Planning"
                    description="Create and iterate on the delivery plan."
                    accent="blue"
                />
                <QuickLink
                    href={`/projects/${projectId}/tasks`}
                    title="Tasks Board"
                    description="Manage execution and Trello sync."
                    accent="gray"
                />
            </div>
        </div>
    );
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent: string }) {
    return (
        <div className="bg-white p-4 rounded shadow-sm border">
            <h3 className="text-xs font-semibold text-gray-500 uppercase">{label}</h3>
            <p className={`text-2xl font-bold mt-2 ${accent}`}>{value}</p>
        </div>
    );
}

function QuickLink({
    href,
    title,
    description,
    accent,
}: {
    href: string;
    title: string;
    description: string;
    accent: "purple" | "blue" | "gray";
}) {
    const accents: Record<typeof accent, { bg: string; border: string; text: string }> = {
        purple: { bg: "bg-purple-50", border: "border-purple-100", text: "text-purple-900" },
        blue: { bg: "bg-blue-50", border: "border-blue-100", text: "text-blue-900" },
        gray: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-900" },
    } as const;
    const palette = accents[accent];

    return (
        <Link href={href} className={`${palette.bg} p-6 rounded border ${palette.border} block hover:shadow transition`}>
            <h3 className={`font-bold mb-2 ${palette.text}`}>{title}</h3>
            <p className="text-sm text-gray-600">{description}</p>
        </Link>
    );
}

function ConversationColumn({
    title,
    emptyText,
    conversations,
}: {
    title: string;
    emptyText: string;
    conversations: Doc<"conversations">[];
}) {
    return (
        <div className="bg-white rounded border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-4">{title}</h3>
            <div className="space-y-3 max-h-64 overflow-y-auto">
                {conversations.map((conversation) => (
                    <ConversationSnippet key={conversation._id} conversation={conversation} />
                ))}
                {conversations.length === 0 && <p className="text-sm text-gray-400">{emptyText}</p>}
            </div>
        </div>
    );
}

function ConversationSnippet({ conversation }: { conversation: Doc<"conversations"> }) {
    const messages = (() => {
        try {
            const parsed = JSON.parse(conversation.messagesJson) as { role: string; content: string }[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    })();

    const assistantMessage = [...messages].reverse().find((msg) => msg.role === "assistant")?.content || "No assistant output captured.";

    return (
        <div className="border rounded p-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span className="capitalize">{conversation.agentRole.replace("_", " ")}</span>
                <span>{new Date(conversation.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm text-gray-800 line-clamp-3 whitespace-pre-wrap">{assistantMessage}</p>
        </div>
    );
}

function QuestProgressChips({
    quests,
}: {
    quests: {
        questId: Id<"quests">;
        title: string;
        percent: number;
        done: number;
        total: number;
    }[];
}) {
    return (
        <div className="bg-white p-4 rounded shadow-sm border">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Quest Progress</h3>
            <div className="flex flex-wrap gap-3">
                {quests.map((quest) => (
                    <div key={quest.questId} className="border rounded-lg px-4 py-3 min-w-[180px]">
                        <p className="text-sm font-semibold text-gray-800 mb-1">{quest.title}</p>
                        <div className="flex justify-between text-xs text-gray-500 mb-2">
                            <span>{quest.done}/{quest.total} done</span>
                            <span>{quest.percent}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-purple-600" style={{ width: `${quest.percent}%` }}></div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
