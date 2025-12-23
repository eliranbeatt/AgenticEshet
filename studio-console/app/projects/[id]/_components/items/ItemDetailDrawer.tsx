"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";

type DrawerProps = {
    itemId: Id<"projectItems"> | null;
    open: boolean;
    onClose: () => void;
};

export function ItemDetailDrawer({ itemId, open, onClose }: DrawerProps) {
    const details = useQuery(
        api.items.getItemDetails,
        itemId ? { itemId } : "skip",
    ) as
        | {
              item: Doc<"projectItems">;
              tasks: Doc<"tasks">[];
              materialLines: Doc<"materialLines">[];
              workLines: Doc<"workLines">[];
              accountingLines: Doc<"accountingLines">[];
              revisions: Doc<"itemRevisions">[];
          }
        | null
        | undefined;

    const content = useMemo(() => {
        if (!details) return null;
        const { item, tasks, materialLines, workLines, accountingLines, revisions } = details;
        return { item, tasks, materialLines, workLines, accountingLines, revisions };
    }, [details]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-40 flex">
            <div className="flex-1 bg-black/40" onClick={onClose} />
            <div className="w-full max-w-xl bg-white shadow-xl border-l flex flex-col">
                <div className="p-4 border-b flex items-start justify-between gap-4">
                    <div>
                        <div className="text-xs text-gray-500">Item details</div>
                        <div className="text-lg font-semibold text-gray-900">
                            {content?.item.name ?? content?.item.title ?? "Item"}
                        </div>
                        {content?.item.category && (
                            <div className="text-xs text-gray-500 mt-1">
                                {content.item.category} - {content.item.status}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {!content && (
                        <div className="text-sm text-gray-500">Loading item details...</div>
                    )}

                    {content && (
                        <>
                            <Section title="Details">
                                <KeyValue label="Name" value={content.item.name ?? content.item.title} />
                                <KeyValue label="Kind" value={content.item.kind ?? "n/a"} />
                                <KeyValue label="Category" value={content.item.category ?? content.item.typeKey ?? "n/a"} />
                                <KeyValue label="Status" value={content.item.status} />
                                <KeyValue label="Description" value={content.item.description ?? "n/a"} />
                            </Section>

                            <Section title="Flags & Scope">
                                <KeyValue label="Flags" value={formatJson(content.item.flags)} />
                                <KeyValue label="Scope" value={formatJson(content.item.scope)} />
                                <KeyValue label="Quote defaults" value={formatJson(content.item.quoteDefaults)} />
                            </Section>

                            <Section title="Rollups">
                                <KeyValue label="Cost" value={formatJson(content.item.rollups?.cost)} />
                                <KeyValue label="Schedule" value={formatJson(content.item.rollups?.schedule)} />
                                <KeyValue label="Tasks" value={formatJson(content.item.rollups?.tasks)} />
                            </Section>

                            <Section title={`Tasks (${content.tasks.length})`}>
                                {content.tasks.length === 0 ? (
                                    <div className="text-xs text-gray-500">No tasks linked yet.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {content.tasks.map((task) => (
                                            <div key={task._id} className="border rounded p-2 text-sm">
                                                <div className="font-semibold text-gray-800">{task.title}</div>
                                                <div className="text-xs text-gray-500">
                                                    {task.status} • {task.durationHours ?? "n/a"} hrs
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Section>

                            <Section title={`Accounting (${content.accountingLines.length + content.materialLines.length + content.workLines.length})`}>
                                {content.accountingLines.length === 0 && content.materialLines.length === 0 && content.workLines.length === 0 ? (
                                    <div className="text-xs text-gray-500">No accounting lines linked yet.</div>
                                ) : (
                                    <div className="space-y-2 text-sm">
                                        {content.accountingLines.map((line) => (
                                            <LineRow key={line._id} label={line.title} meta={`accounting • ${line.lineType}`} />
                                        ))}
                                        {content.materialLines.map((line) => (
                                            <LineRow key={line._id} label={line.label} meta="material line" />
                                        ))}
                                        {content.workLines.map((line) => (
                                            <LineRow key={line._id} label={line.role} meta="work line" />
                                        ))}
                                    </div>
                                )}
                            </Section>

                            <Section title={`History (${content.revisions.length})`}>
                                {content.revisions.length === 0 ? (
                                    <div className="text-xs text-gray-500">No revisions yet.</div>
                                ) : (
                                    <div className="space-y-2 text-xs text-gray-600">
                                        {content.revisions
                                            .slice()
                                            .sort((a, b) => b.revisionNumber - a.revisionNumber)
                                            .map((rev) => (
                                                <div key={rev._id} className="border rounded p-2">
                                                    <div className="font-semibold text-gray-700">
                                                        v{rev.revisionNumber} • {rev.tabScope} • {rev.state}
                                                    </div>
                                                    <div>{new Date(rev.createdAt).toLocaleString()}</div>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </Section>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
            <div className="space-y-2">{children}</div>
        </div>
    );
}

function KeyValue({ label, value }: { label: string; value?: string }) {
    return (
        <div className="text-sm">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-gray-800 whitespace-pre-wrap">{value ?? "n/a"}</div>
        </div>
    );
}

function LineRow({ label, meta }: { label: string; meta: string }) {
    return (
        <div className="border rounded p-2">
            <div className="font-semibold text-gray-800">{label}</div>
            <div className="text-xs text-gray-500">{meta}</div>
        </div>
    );
}

function formatJson(value: unknown) {
    if (!value || (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)) {
        return "n/a";
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
