"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const HIGH_CONFIDENCE = 0.85;

export function FactsPanel({ projectId }: { projectId: Id<"projects"> }) {
    const project = useQuery(api.projects.getProject, { projectId });
    const grouped = useQuery(api.factsPipeline.listFactsGrouped, { projectId });
    const itemsTree = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const registry = useQuery(api.registry.getElementRegistry, {});

    const acceptFact = useMutation(api.factsPipeline.acceptFact);
    const rejectFact = useMutation(api.factsPipeline.rejectFact);
    const bulkAcceptFacts = useMutation(api.factsPipeline.bulkAcceptFacts);
    const updateFactMapping = useMutation(api.factsPipeline.updateFactMapping);

    const [statusFilter, setStatusFilter] = useState<"all" | "accepted" | "proposed" | "rejected">("all");

    const items = useMemo(() => itemsTree?.items ?? [], [itemsTree]);
    const fields = registry?.fields ?? [];
    const buckets = registry?.buckets ?? [];

    const allFacts = useMemo(() => grouped?.flatMap((entry) => entry.facts) ?? [], [grouped]);
    const filteredFacts = useMemo(() => {
        if (statusFilter === "all") return allFacts;
        return allFacts.filter((fact) => fact.status === statusFilter);
    }, [allFacts, statusFilter]);

    const highConfidenceFacts = useMemo(
        () => filteredFacts.filter((fact) => fact.status === "proposed" && (fact.confidence ?? 0) >= HIGH_CONFIDENCE),
        [filteredFacts],
    );

    if (project?.features?.factsEnabled === false) {
        return <div className="text-xs text-gray-500 p-3">Facts are disabled for this project.</div>;
    }

    if (!grouped || !itemsTree || !registry) {
        return <div className="text-xs text-gray-500">Loading facts...</div>;
    }

    const handleMappingChange = (factId: Id<"facts">, value: string) => {
        if (!value) {
            void updateFactMapping({ factId, fieldPath: undefined, bucketKey: undefined });
            return;
        }
        if (value.startsWith("field:")) {
            void updateFactMapping({ factId, fieldPath: value.replace("field:", ""), bucketKey: undefined });
            return;
        }
        if (value.startsWith("bucket:")) {
            void updateFactMapping({ factId, fieldPath: undefined, bucketKey: value.replace("bucket:", "") });
        }
    };

    return (
        <div className="flex flex-col h-full bg-white border-l">
            <div className="p-3 border-b flex items-center justify-between bg-gray-50">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-700">Facts</div>
                    <div className="text-[10px] text-gray-500">Grouped by category</div>
                </div>
                <button
                    type="button"
                    onClick={() => bulkAcceptFacts({ factIds: highConfidenceFacts.map((fact) => fact._id) })}
                    disabled={highConfidenceFacts.length === 0}
                    className="text-[10px] px-2 py-1 rounded bg-green-600 text-white disabled:opacity-50"
                >
                    Accept high-confidence ({highConfidenceFacts.length})
                </button>
            </div>

            <div className="px-3 py-2 border-b text-[10px] text-gray-600 flex gap-2 flex-wrap">
                {(["all", "accepted", "proposed", "rejected"] as const).map((status) => (
                    <button
                        key={status}
                        onClick={() => setStatusFilter(status)}
                        className={`px-2 py-0.5 rounded ${
                            statusFilter === status ? "bg-blue-100 text-blue-700" : "text-gray-500"
                        }`}
                    >
                        {status}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {grouped.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-4">No facts found.</div>
                )}
                {grouped.map((group) => {
                    const visibleFacts = group.facts.filter((fact) =>
                        statusFilter === "all" ? true : fact.status === statusFilter,
                    );
                    if (visibleFacts.length === 0) return null;

                    return (
                        <div key={group.categoryHe} className="space-y-2">
                            <div className="text-[11px] font-semibold text-gray-600">{group.categoryHe}</div>
                            {visibleFacts.map((fact) => {
                                const mappingValue = fact.fieldPath
                                    ? `field:${fact.fieldPath}`
                                    : fact.bucketKey
                                        ? `bucket:${fact.bucketKey}`
                                        : "";
                                return (
                                    <div key={fact._id} className="p-2 rounded border text-xs border-gray-200 bg-white">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1">
                                                <div className="font-semibold text-gray-900">
                                                    {fact.valueTextHe ?? String(fact.valueTyped ?? fact.value ?? "")}
                                                </div>
                                                <div className="text-[10px] text-gray-500">
                                                    {fact.type} - confidence {(fact.confidence ?? 0).toFixed(2)}
                                                </div>
                                            </div>
                                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-gray-100 text-gray-600">
                                                {fact.status}
                                            </span>
                                        </div>

                                        <div className="mt-2 grid gap-2 text-[10px] text-gray-600">
                                            <div className="flex items-center gap-2">
                                                <span>Element:</span>
                                                <select
                                                    className="border rounded text-[10px] p-1"
                                                    value={fact.elementId ? String(fact.elementId) : ""}
                                                    onChange={(event) => {
                                                        const elementId = event.target.value as Id<"projectItems">;
                                                        void updateFactMapping({
                                                            factId: fact._id,
                                                            elementId: elementId || null,
                                                        });
                                                    }}
                                                >
                                                    <option value="">Project-level</option>
                                                    {items.map((item) => (
                                                        <option key={item._id} value={item._id}>
                                                            {item.title ?? item.name ?? "Untitled element"}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span>Mapping:</span>
                                                <select
                                                    className="border rounded text-[10px] p-1"
                                                    value={mappingValue}
                                                    onChange={(event) => handleMappingChange(fact._id, event.target.value)}
                                                >
                                                    <option value="">Unmapped</option>
                                                    <optgroup label="Fields">
                                                        {fields.map((field) => (
                                                            <option key={field.path} value={`field:${field.path}`}>
                                                                {field.labelHe}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                    <optgroup label="Buckets">
                                                        {buckets.map((bucket) => (
                                                            <option key={bucket.key} value={`bucket:${bucket.key}`}>
                                                                {bucket.labelHe}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-2 mt-2">
                                            {fact.status === "proposed" && (
                                                <>
                                                    <button
                                                        onClick={() => acceptFact({ factId: fact._id })}
                                                        className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                                                    >
                                                        Accept
                                                    </button>
                                                    <button
                                                        onClick={() => rejectFact({ factId: fact._id })}
                                                        className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                                    >
                                                        Reject
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

