"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";

type DetailsFormState = {
    status: "lead" | "planning" | "production" | "archived";
    stage: "ideation" | "planning" | "production" | "done";
    budgetTier: "low" | "medium" | "high" | "unknown";
    defaultLanguage: "he" | "en";
    projectTypes: Array<"dressing" | "studio_build" | "print_install" | "big_install_takedown" | "photoshoot">;
    relatedPastProjectIds: Id<"projects">[];
    eventDate: string;
    budgetCap: string;
    location: string;
    notes: string;
};

type RecentDocUpload = {
    _id: Id<"knowledgeDocs">;
    title: string;
    createdAt: number;
    processingStatus: Doc<"knowledgeDocs">["processingStatus"];
};

const statusOptions: DetailsFormState["status"][] = ["lead", "planning", "production", "archived"];
const stageOptions: DetailsFormState["stage"][] = ["ideation", "planning", "production", "done"];
const budgetTierOptions: DetailsFormState["budgetTier"][] = ["low", "medium", "high", "unknown"];
const languageOptions: DetailsFormState["defaultLanguage"][] = ["he", "en"];
const projectTypeOptions: Array<{ value: DetailsFormState["projectTypes"][number]; label: string }> = [
    { value: "dressing", label: "Dressing" },
    { value: "studio_build", label: "Studio build" },
    { value: "print_install", label: "Print / install" },
    { value: "big_install_takedown", label: "Big install / takedown" },
    { value: "photoshoot", label: "Photoshoot" },
];

export default function ProjectOverviewPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const project = useQuery(api.projects.getProject, { projectId });
    const tasks = useQuery(api.tasks.listByProject, { projectId });
    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const allProjects = useQuery(api.projects.listProjects, {});
    const recentDocUploads = useQuery(api.knowledge.listRecentDocs, {
        projectId,
        limit: 6,
        sourceTypes: ["doc_upload"],
    });
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
    const trelloSync = useQuery(api.trelloSync.getSyncState, { projectId });
    const quotes = useQuery(api.agents.quote.listQuotes, { projectId });
    const updateProject = useMutation(api.projects.updateProject);
    const createIngestionJob = useMutation(api.ingestion.createJob);
    const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);
    const addFilesToJob = useMutation(api.ingestion.addFilesToJob);
    const runIngestionJob = useAction(api.ingestion.runJob);

    const [formState, setFormState] = useState<DetailsFormState>({
        status: "lead",
        stage: "ideation",
        budgetTier: "unknown",
        defaultLanguage: "he",
        projectTypes: [],
        relatedPastProjectIds: [],
        eventDate: "",
        budgetCap: "",
        location: "",
        notes: "",
    });
    const [isSaving, setIsSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const docFileInputRef = useRef<HTMLInputElement>(null);
    const [isUploadingDocs, setIsUploadingDocs] = useState(false);
    const [docUploadContext, setDocUploadContext] = useState("");
    const [docUploadTags, setDocUploadTags] = useState("");

    useEffect(() => {
        if (project) {
            setFormState({
                status: project.status,
                stage: project.stage ?? "ideation",
                budgetTier: project.budgetTier ?? "unknown",
                defaultLanguage: project.defaultLanguage ?? "he",
                projectTypes: project.projectTypes ?? [],
                relatedPastProjectIds: project.relatedPastProjectIds ?? [],
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
            todo: tasks.filter((t: Doc<"tasks">) => t.status === "todo").length,
            inProgress: tasks.filter((t: Doc<"tasks">) => t.status === "in_progress").length,
            done: tasks.filter((t: Doc<"tasks">) => t.status === "done").length,
        };
    }, [tasks]);

    const latestQuote = quotes && quotes.length > 0 ? quotes[0] : null;

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
                stage: formState.stage,
                budgetTier: formState.budgetTier,
                defaultLanguage: formState.defaultLanguage,
                projectTypes: formState.projectTypes,
                relatedPastProjectIds: formState.relatedPastProjectIds,
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

    const handleDocUpload = async (event: React.FormEvent) => {
        event.preventDefault();
        const files = docFileInputRef.current?.files;
        if (!files || files.length === 0) return;

        setIsUploadingDocs(true);
        try {
            const parsedTags = docUploadTags
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);

            const jobId = await createIngestionJob({
                projectId,
                name: `Quick upload ${new Date().toLocaleString()}`,
                sourceType: "upload",
                defaultContext: docUploadContext.trim() || undefined,
                defaultTags: parsedTags.length > 0 ? parsedTags : undefined,
            });

            const uploadedFiles: Array<{ storageId: string; name: string; mimeType: string; size: number }> = [];
            for (const file of Array.from(files)) {
                const postUrl = await generateUploadUrl();
                const result = await fetch(postUrl, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                });
                const { storageId } = await result.json();
                uploadedFiles.push({
                    storageId,
                    name: file.name,
                    mimeType: file.type || "application/octet-stream",
                    size: file.size,
                });
            }

            await addFilesToJob({ jobId, files: uploadedFiles });
            await runIngestionJob({ jobId });

            setDocUploadContext("");
            setDocUploadTags("");
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Upload failed";
            alert(message);
        } finally {
            setIsUploadingDocs(false);
            if (docFileInputRef.current) {
                docFileInputRef.current.value = "";
            }
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

                    <div className="bg-white p-6 rounded shadow-sm border space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold uppercase text-gray-500 tracking-wide">Upload documents</h3>
                                <p className="text-sm text-gray-600 mt-2">
                                    Uploaded files are ingested into the Knowledge Base and automatically summarized with key points. Clarification and downstream agents pull them as context.
                                </p>
                            </div>
                            <Link
                                href={`/projects/${projectId}/knowledge`}
                                className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap"
                            >
                                Manage in Knowledge
                            </Link>
                        </div>

                        <form onSubmit={handleDocUpload} className="space-y-3">
                            <input
                                ref={docFileInputRef}
                                type="file"
                                multiple
                                className="w-full border rounded px-3 py-2 text-sm"
                                accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls,.ppt,.pptx,.json,.html,.htm,.rtf"
                            />
                            <input
                                type="text"
                                value={docUploadContext}
                                onChange={(e) => setDocUploadContext(e.target.value)}
                                placeholder="Optional context (e.g. client brief, assumptions, source)"
                                className="w-full border rounded px-3 py-2 text-sm"
                            />
                            <input
                                type="text"
                                value={docUploadTags}
                                onChange={(e) => setDocUploadTags(e.target.value)}
                                placeholder="Optional tags (comma separated)"
                                className="w-full border rounded px-3 py-2 text-sm"
                            />
                            <button
                                type="submit"
                                disabled={isUploadingDocs}
                                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                            >
                                {isUploadingDocs ? "Uploading..." : "Upload & process"}
                            </button>
                        </form>

                        <div className="space-y-2">
                            <div className="text-xs font-semibold uppercase text-gray-500 tracking-wide">Recent uploads</div>
                            {recentDocUploads === undefined ? (
                                <div className="text-sm text-gray-400">Loading...</div>
                            ) : recentDocUploads.length === 0 ? (
                                <div className="text-sm text-gray-400">No documents uploaded yet.</div>
                            ) : (
                                <ul className="space-y-2">
                                    {recentDocUploads.map((doc: RecentDocUpload) => (
                                        <li key={doc._id} className="flex items-center justify-between gap-3 border rounded px-3 py-2">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-gray-900 truncate" title={doc.title}>
                                                    {doc.title}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    {new Date(doc.createdAt).toLocaleString()}
                                                </div>
                                            </div>
                                            <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-gray-100 text-gray-700">
                                                {doc.processingStatus}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <PlanStatusCard planMeta={planMeta} />
                        <OpsPulseCard trelloSync={trelloSync} latestQuote={latestQuote} />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <MetricCard label="Total Tasks" value={metrics.total} accent="text-gray-800" />
                        <MetricCard label="To Do" value={metrics.todo} accent="text-amber-600" />
                        <MetricCard label="In Progress" value={metrics.inProgress} accent="text-blue-600" />
                        <MetricCard label="Done" value={metrics.done} accent="text-emerald-600" />
                    </div>

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
                            <label className="block text-xs font-medium text-gray-500 mb-1">Stage</label>
                            <select
                                value={formState.stage}
                                onChange={(e) =>
                                    setFormState((prev) => ({ ...prev, stage: e.target.value as DetailsFormState["stage"] }))
                                }
                                className="w-full border rounded px-3 py-2 text-sm"
                            >
                                {stageOptions.map((stage) => (
                                    <option key={stage} value={stage}>
                                        {stage}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Project Types</label>
                            <div className="flex flex-wrap gap-3 border rounded px-3 py-2">
                                {projectTypeOptions.map((opt) => {
                                    const checked = formState.projectTypes.includes(opt.value);
                                    return (
                                        <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(event) => {
                                                    if (event.target.checked) {
                                                        setFormState((prev) => ({
                                                            ...prev,
                                                            projectTypes: [...prev.projectTypes, opt.value],
                                                        }));
                                                    } else {
                                                        setFormState((prev) => ({
                                                            ...prev,
                                                            projectTypes: prev.projectTypes.filter((t) => t !== opt.value),
                                                        }));
                                                    }
                                                }}
                                            />
                                            <span>{opt.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Budget Tier</label>
                                <select
                                    value={formState.budgetTier}
                                    onChange={(e) =>
                                        setFormState((prev) => ({
                                            ...prev,
                                            budgetTier: e.target.value as DetailsFormState["budgetTier"],
                                        }))
                                    }
                                    className="w-full border rounded px-3 py-2 text-sm"
                                >
                                    {budgetTierOptions.map((tier) => (
                                        <option key={tier} value={tier}>
                                            {tier}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Default Language</label>
                                <select
                                    value={formState.defaultLanguage}
                                    onChange={(e) =>
                                        setFormState((prev) => ({
                                            ...prev,
                                            defaultLanguage: e.target.value as DetailsFormState["defaultLanguage"],
                                        }))
                                    }
                                    className="w-full border rounded px-3 py-2 text-sm"
                                >
                                    {languageOptions.map((lang) => (
                                        <option key={lang} value={lang}>
                                            {lang}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Related Past Projects</label>
                            <div className="border rounded px-3 py-2 max-h-40 overflow-y-auto space-y-2">
                                {allProjects
                                    ?.filter((p: Doc<"projects">) => p._id !== projectId)
                                    .map((p: Doc<"projects">) => {
                                        const checked = formState.relatedPastProjectIds.includes(p._id);
                                        return (
                                            <label key={p._id} className="flex items-center gap-2 text-sm text-gray-700">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={(event) => {
                                                        if (event.target.checked) {
                                                            setFormState((prev) => ({
                                                                ...prev,
                                                                relatedPastProjectIds: [...prev.relatedPastProjectIds, p._id],
                                                            }));
                                                        } else {
                                                            setFormState((prev) => ({
                                                                ...prev,
                                                                relatedPastProjectIds: prev.relatedPastProjectIds.filter(
                                                                    (id) => id !== p._id
                                                                ),
                                                            }));
                                                        }
                                                    }}
                                                />
                                                <span className="truncate">{p.name}</span>
                                            </label>
                                        );
                                    })}
                                {allProjects && allProjects.length <= 1 && (
                                    <div className="text-xs text-gray-500">No other projects available.</div>
                                )}
                                {allProjects === undefined && <div className="text-xs text-gray-500">Loading…</div>}
                            </div>
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
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                <QuickLink
                    href={`/projects/${projectId}/ideation`}
                    title="Ideation"
                    description="Generate concept directions and moodboards."
                    accent="purple"
                />
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
                <QuickLink
                    href={`/projects/${projectId}/quote`}
                    title="Quote Studio"
                    description="Review client pricing packages."
                    accent="blue"
                />
                <QuickLink
                    href={`/projects/${projectId}/knowledge`}
                    title="Knowledge Base"
                    description="Search docs and manage ingestion."
                    accent="purple"
                />
            </div>
        </div>
    );
}

function PlanStatusCard({
    planMeta,
}: {
    planMeta:
        | {
              activePlan: { planId: Id<"plans">; version: number; approvedAt: number } | null;
              latestPlan: { planId: Id<"plans">; version: number; isDraft: boolean } | null;
              totalPlans: number;
              draftCount: number;
          }
        | null
        | undefined;
}) {
    const activeLabel = planMeta?.activePlan
        ? `Active plan v${planMeta.activePlan.version}`
        : planMeta?.latestPlan
            ? planMeta.latestPlan.isDraft
                ? "Latest draft waiting approval"
                : `Latest plan v${planMeta.latestPlan.version}`
            : "No plan yet";
    return (
        <div className="bg-gray-900 text-white rounded-lg p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-300">Planning status</p>
            <h3 className="text-lg font-semibold mt-2">{activeLabel}</h3>
            <div className="text-xs text-gray-400 mt-4 flex items-center gap-4">
                <span>{planMeta?.totalPlans ?? 0} total versions</span>
                <span>{planMeta?.draftCount ?? 0} drafts</span>
            </div>
        </div>
    );
}

function OpsPulseCard({
    trelloSync,
    latestQuote,
}: {
    trelloSync:
        | {
              lastSyncedAt: number | null;
              mappedTaskCount: number;
              totalTasks: number;
              unmappedTasks: number;
          }
        | null
        | undefined;
    latestQuote: Doc<"quotes"> | null;
}) {
    return (
        <div className="bg-white border rounded-lg p-5 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Operations pulse</p>
            <div className="space-y-3">
                <div>
                    <div className="text-xs text-gray-500">Last Trello sync</div>
                    <div className="text-sm font-medium text-gray-900">
                        {trelloSync?.lastSyncedAt ? new Date(trelloSync.lastSyncedAt).toLocaleString() : "Never"}
                    </div>
                    <div className="text-xs text-gray-500">
                        {trelloSync ? `${trelloSync.mappedTaskCount}/${trelloSync.totalTasks} mapped` : "No mapping yet"}
                    </div>
                </div>
                <div>
                    <div className="text-xs text-gray-500">Last quote total</div>
                    <div className="text-sm font-medium text-gray-900">
                        {latestQuote
                            ? `${latestQuote.totalAmount.toLocaleString()} ${latestQuote.currency}`
                            : "No quote"}
                    </div>
                    {latestQuote && (
                        <div className="text-xs text-gray-500">
                            Version v{latestQuote.version} • {new Date(latestQuote.createdAt).toLocaleDateString()}
                        </div>
                    )}
                </div>
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

