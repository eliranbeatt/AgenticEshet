
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { createEmptyItemSpec, ItemSpecV2 } from "../../../../../lib/items";
import { mergeItemSpec } from "../../../../../lib/itemsMerge";
import { useItemsContext } from "./ItemsContext";
import { ItemBreakdownEditor } from "./ItemBreakdownEditor";
import { ItemRevisionBanner } from "./ItemRevisionBanner";
import { ImageGeneratorPanel } from "../images/ImageGeneratorPanel";
import { ImagePicker } from "../images/ImagePicker";
import { ItemDetailDrawer } from "./ItemDetailDrawer";

function formatFactValue(value: unknown) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "object") {
        if ("value" in value && "unit" in value) {
            const inner = value as { value?: number | string; unit?: string };
            return `${inner.value ?? ""} ${inner.unit ?? ""}`.trim();
        }
        if ("min" in value || "max" in value) {
            const inner = value as { min?: number | string; max?: number | string };
            const min = inner.min ?? "";
            const max = inner.max ?? "";
            return `${min}-${max}`.replace(/^-/, "").replace(/-$/, "");
        }
        if ("iso" in value) {
            const inner = value as { iso?: string };
            return inner.iso ?? "";
        }
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function parseLines(value: string) {
    return value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function formatLines(lines: string[]) {
    return lines.join("\n");
}

function parseTags(value: string) {
    return value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
}

function parseMilestones(value: string) {
    return parseLines(value).map((line) => {
        const [name, date] = line.split("|").map((part) => part.trim());
        return date ? { name, date } : { name };
    });
}

function formatMilestones(milestones?: Array<{ name: string; date?: string }>) {
    if (!milestones) return "";
    return milestones.map((m) => (m.date ? `${m.name} | ${m.date}` : m.name)).join("\n");
}

function findLatestDraft(revisions: Doc<"itemRevisions">[], tabScope?: string) {
    if (!tabScope) return null;
    return (
        revisions
            .filter((rev) => rev.tabScope === tabScope && rev.state === "proposed")
            .sort((a, b) => b.revisionNumber - a.revisionNumber)[0] ?? null
    );
}

function findApprovedRevision(revisions: Doc<"itemRevisions">[], approvedRevisionId?: Id<"itemRevisions">) {
    if (!approvedRevisionId) return null;
    return revisions.find((rev) => rev._id === approvedRevisionId) ?? null;
}

export function ItemEditorPanel() {
    const { projectId, selectedItemId, tabScope } = useItemsContext();
    const itemData = useQuery(
        api.items.getItem,
        selectedItemId ? { itemId: selectedItemId } : "skip",
    );
    const allFacts = useQuery(api.factsV2.listFacts, { projectId });
    const upsertRevision = useMutation(api.items.upsertRevision);
    const populateFromFacts = useAction(api.agents.itemPopulator.populate);

    const [specDraft, setSpecDraft] = useState<ItemSpecV2 | null>(null);
    const [changeReason, setChangeReason] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isPopulating, setIsPopulating] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const { item, draftRevision, approvedRevision } = useMemo(() => {
        if (!itemData) {
            return { item: null, draftRevision: null, approvedRevision: null };
        }
        const item = itemData.item;
        const revisions = itemData.revisions ?? [];
        const draft = findLatestDraft(revisions, tabScope);
        const approved = findApprovedRevision(revisions, item.approvedRevisionId);
        return { item, draftRevision: draft, approvedRevision: approved };
    }, [itemData, tabScope]);

    const itemFacts = useMemo(() => {
        if (!allFacts || !selectedItemId) return [];
        return allFacts.filter(
            (fact) =>
                fact.itemId === selectedItemId &&
                (fact.status === "accepted" || fact.status === "proposed"),
        );
    }, [allFacts, selectedItemId]);

    useEffect(() => {
        if (!item) {
            setSpecDraft(null);
            return;
        }
        const base = createEmptyItemSpec(item.title, item.typeKey);
        const sourceSpec = (draftRevision?.data ?? approvedRevision?.data) as ItemSpecV2 | undefined;
        const merged = sourceSpec ? mergeItemSpec(base, sourceSpec) : base;
        setSpecDraft(merged);
        setChangeReason("");
    }, [approvedRevision?.data, draftRevision?.data, item, item?.title, item?.typeKey]);

    if (!selectedItemId) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-4 text-sm text-gray-500">
                Select an element to edit its details.
            </div>
        );
    }

    if (!item || !specDraft) {
        return (
            <div className="bg-white border rounded-lg shadow-sm p-4 text-sm text-gray-500">
                Loading element details...
            </div>
        );
    }

    const identity = specDraft.identity;
    const quality = specDraft.quality ?? { tier: "medium", notes: "" };
    const budgeting = specDraft.budgeting ?? {};
    const procurement = specDraft.procurement ?? { required: false, channel: "none" };
    const studioWork = specDraft.studioWork ?? { required: false };
    const logistics = specDraft.logistics ?? { transportRequired: false };
    const onsite = specDraft.onsite ?? {};
    const safety = specDraft.safety ?? {};
    const quote = specDraft.quote ?? { includeInQuote: true };

    const updateSpec = (next: ItemSpecV2) => setSpecDraft(next);

    const applyFactsToAssumptions = () => {
        if (!specDraft) return;
        const existing = new Set(specDraft.state.assumptions.map((entry) => entry.trim()));
        const additions = itemFacts
            .map((fact) => fact.factTextHe.trim())
            .filter((text) => text && !existing.has(text));
        if (additions.length === 0) return;
        updateSpec({
            ...specDraft,
            state: {
                ...specDraft.state,
                assumptions: [...specDraft.state.assumptions, ...additions],
            },
        });
    };

    const saveRevision = async () => {
        if (!tabScope) return;
        setIsSaving(true);
        try {
            await upsertRevision({
                itemId: selectedItemId,
                tabScope,
                dataOrPatch: specDraft,
                changeReason: changeReason.trim() || undefined,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handlePopulate = async () => {
        if (!selectedItemId) return;
        setIsPopulating(true);
        try {
            await populateFromFacts({
                itemId: selectedItemId,
                revisionId: draftRevision?._id
            });
        } catch (e) {
            console.error("Failed to populate:", e);
            alert("Failed to populate from facts");
        } finally {
            setIsPopulating(false);
        }
    };

    return (
        <div className="bg-white border rounded-lg shadow-sm p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs text-gray-500">Element</div>
                    <div className="text-lg font-semibold text-gray-900">{identity.title}</div>
                    <div className="text-xs text-gray-500 mt-1">
                        {item.typeKey} - {item.status}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                        onClick={() => setShowDetails(true)}
                    >
                        Details
                    </button>
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 flex items-center gap-1"
                        onClick={handlePopulate}
                        disabled={isPopulating}
                    >
                        {isPopulating ? "✨ Populating..." : "✨ Populate from Facts"}
                    </button>
                    <button
                        type="button"
                        className="text-sm px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        disabled={!tabScope || isSaving}
                        onClick={saveRevision}
                    >
                        {isSaving ? "Saving..." : tabScope ? `Save ${tabScope} draft` : "Save draft"}
                    </button>
                </div>
            </div>

            {draftRevision && (
                <ItemRevisionBanner
                    itemId={item._id}
                    revisionId={draftRevision._id}
                    revisionNumber={draftRevision.revisionNumber}
                    summaryMarkdown={draftRevision.summaryMarkdown}
                />
            )}

            <SectionTitle title="Linked facts" />
            <div className="space-y-2">
                {itemFacts.length === 0 ? (
                    <div className="text-sm text-gray-500">No facts linked to this element yet.</div>
                ) : (
                    <div className="space-y-2">
                        <ul className="space-y-1 text-xs text-gray-700 list-disc pl-4">
                            {itemFacts.map((fact) => (
                                <li key={fact._id}>
                                    <div className="font-medium text-gray-800">{fact.factTextHe}</div>
                                    {fact.key && (
                                        <div className="text-[10px] text-gray-500">
                                            {fact.key}
                                            {fact.value !== undefined ? `: ${formatFactValue(fact.value)}` : ""}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                                onClick={applyFactsToAssumptions}
                            >
                                Apply to assumptions
                            </button>
                            <div className="text-[10px] text-gray-500">
                                Adds linked facts into the Assumptions field below.
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <SectionTitle title="Identity" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Title</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={identity.title}
                        onChange={(e) => updateSpec({ ...specDraft, identity: { ...identity, title: e.target.value } })}
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={identity.typeKey}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, identity: { ...identity, typeKey: e.target.value } })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Description</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[90px]"
                        value={identity.description ?? ""}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, identity: { ...identity, description: e.target.value } })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Tags</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={(identity.tags ?? []).join(", ")}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, identity: { ...identity, tags: parseTags(e.target.value) } })
                        }
                        placeholder="tag1, tag2"
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Accounting group</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={identity.accountingGroup ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                identity: { ...identity, accountingGroup: e.target.value },
                            })
                        }
                        dir="rtl"
                    />
                </label>
            </div>

            <SectionTitle title="Quality & Budgeting" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Quality tier</div>
                    <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={quality.tier}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                quality: {
                                    ...quality,
                                    tier: e.target.value as NonNullable<ItemSpecV2["quality"]>["tier"],
                                },
                            })
                        }
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Quality notes</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={quality.notes ?? ""}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, quality: { ...quality, notes: e.target.value } })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Estimate amount</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={budgeting.estimate?.amount?.toString() ?? ""}
                        onChange={(e) => {
                            const amount = e.target.value ? Number(e.target.value) : undefined;
                            updateSpec({
                                ...specDraft,
                                budgeting: {
                                    ...budgeting,
                                    estimate: {
                                        amount,
                                        currency: "ILS",
                                        confidence: budgeting.estimate?.confidence,
                                    },
                                },
                            });
                        }}
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Confidence (0-1)</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={budgeting.estimate?.confidence?.toString() ?? ""}
                        onChange={(e) => {
                            const confidence = e.target.value ? Number(e.target.value) : undefined;
                            updateSpec({
                                ...specDraft,
                                budgeting: {
                                    ...budgeting,
                                    estimate: {
                                        amount: budgeting.estimate?.amount,
                                        currency: "ILS",
                                        confidence,
                                    },
                                },
                            });
                        }}
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Range min</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={budgeting.range?.min?.toString() ?? ""}
                        onChange={(e) => {
                            const min = e.target.value ? Number(e.target.value) : undefined;
                            updateSpec({
                                ...specDraft,
                                budgeting: {
                                    ...budgeting,
                                    range: {
                                        min,
                                        max: budgeting.range?.max,
                                    },
                                },
                            });
                        }}
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Range max</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={budgeting.range?.max?.toString() ?? ""}
                        onChange={(e) => {
                            const max = e.target.value ? Number(e.target.value) : undefined;
                            updateSpec({
                                ...specDraft,
                                budgeting: {
                                    ...budgeting,
                                    range: {
                                        min: budgeting.range?.min,
                                        max,
                                    },
                                },
                            });
                        }}
                    />
                </label>
            </div>

            <SectionTitle title="Procurement & Studio Work" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={procurement.required}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                procurement: { ...procurement, required: e.target.checked },
                            })
                        }
                    />
                    Procurement required
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Channel</div>
                    <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={procurement.channel}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                procurement: {
                                    ...procurement,
                                    channel: e.target.value as NonNullable<ItemSpecV2["procurement"]>["channel"],
                                },
                            })
                        }
                    >
                        <option value="none">None</option>
                        <option value="local">Local</option>
                        <option value="abroad">Abroad</option>
                        <option value="both">Both</option>
                    </select>
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Lead time (days)</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={procurement.leadTimeDays?.toString() ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                procurement: {
                                    ...procurement,
                                    leadTimeDays: e.target.value ? Number(e.target.value) : undefined,
                                },
                            })
                        }
                    />
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Purchase list (one per line)
                    </div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[90px]"
                        value={(procurement.purchaseList ?? []).map((p) => p.label).join("\n")}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                procurement: {
                                    ...procurement,
                                    purchaseList: parseLines(e.target.value).map((label) => ({ label })),
                                },
                            })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={studioWork.required}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                studioWork: { ...studioWork, required: e.target.checked },
                            })
                        }
                    />
                    Studio work required
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Work types</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={(studioWork.workTypes ?? []).join(", ")}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                studioWork: { ...studioWork, workTypes: parseTags(e.target.value) },
                            })
                        }
                        placeholder="carpentry, paint"
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Est minutes</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={studioWork.estMinutes?.toString() ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                studioWork: { ...studioWork, estMinutes: e.target.value ? Number(e.target.value) : undefined },
                            })
                        }
                    />
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Build plan</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[120px]"
                        value={studioWork.buildPlanMarkdown ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                studioWork: { ...studioWork, buildPlanMarkdown: e.target.value },
                            })
                        }
                        dir="rtl"
                    />
                </label>
            </div>

            <SectionTitle title="Logistics & Onsite" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={logistics.transportRequired}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                logistics: { ...logistics, transportRequired: e.target.checked },
                            })
                        }
                    />
                    Transport required
                </label>
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={logistics.storageRequired ?? false}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                logistics: { ...logistics, storageRequired: e.target.checked },
                            })
                        }
                    />
                    Storage required
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Packaging notes</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                        value={logistics.packagingNotes ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                logistics: { ...logistics, packagingNotes: e.target.value },
                            })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Install days</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={onsite.installDays?.toString() ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                onsite: { ...onsite, installDays: e.target.value ? Number(e.target.value) : undefined },
                            })
                        }
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Shoot days</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={onsite.shootDays?.toString() ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                onsite: { ...onsite, shootDays: e.target.value ? Number(e.target.value) : undefined },
                            })
                        }
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Teardown days</div>
                    <input
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={onsite.teardownDays?.toString() ?? ""}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                onsite: { ...onsite, teardownDays: e.target.value ? Number(e.target.value) : undefined },
                            })
                        }
                    />
                </label>
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={onsite.operatorDuringEvent ?? false}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                onsite: { ...onsite, operatorDuringEvent: e.target.checked },
                            })
                        }
                    />
                    Operator during event
                </label>
            </div>

            <SectionTitle title="Safety" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={safety.publicInteraction ?? false}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                safety: { ...safety, publicInteraction: e.target.checked },
                            })
                        }
                    />
                    Public interaction
                </label>
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={safety.electrical ?? false}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, safety: { ...safety, electrical: e.target.checked } })
                        }
                    />
                    Electrical
                </label>
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={safety.weightBearing ?? false}
                        onChange={(e) =>
                            updateSpec({ ...specDraft, safety: { ...safety, weightBearing: e.target.checked } })
                        }
                    />
                    Weight bearing
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Safety notes</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                        value={safety.notes ?? ""}
                        onChange={(e) => updateSpec({ ...specDraft, safety: { ...safety, notes: e.target.value } })}
                        dir="rtl"
                    />
                </label>
            </div>

            <SectionTitle title="Breakdown" />
            <ItemBreakdownEditor spec={specDraft} onChange={updateSpec} />

            <SectionTitle title="State" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Open questions</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[90px]"
                        value={formatLines(specDraft.state.openQuestions)}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                state: { ...specDraft.state, openQuestions: parseLines(e.target.value) },
                            })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Assumptions</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[90px]"
                        value={formatLines(specDraft.state.assumptions)}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                state: { ...specDraft.state, assumptions: parseLines(e.target.value) },
                            })
                        }
                        dir="rtl"
                    />
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Decisions</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[90px]"
                        value={formatLines(specDraft.state.decisions)}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                state: { ...specDraft.state, decisions: parseLines(e.target.value) },
                            })
                        }
                        dir="rtl"
                    />
                </label>
            </div>

            <SectionTitle title="Quote" />
            <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={quote.includeInQuote}
                        onChange={(e) => updateSpec({ ...specDraft, quote: { ...quote, includeInQuote: e.target.checked } })}
                    />
                    Include in quote
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Client text override</div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                        value={quote.clientTextOverride ?? ""}
                        onChange={(e) => updateSpec({ ...specDraft, quote: { ...quote, clientTextOverride: e.target.value } })}
                        dir="rtl"
                    />
                </label>
                <label className="text-sm md:col-span-2">
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Milestones (one per line, optional date after |)
                    </div>
                    <textarea
                        className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[80px]"
                        value={formatMilestones(quote.milestones)}
                        onChange={(e) =>
                            updateSpec({
                                ...specDraft,
                                quote: { ...quote, milestones: parseMilestones(e.target.value) },
                            })
                        }
                        dir="rtl"
                    />
                </label>
            </div>

            <SectionTitle title="Change reason" />
            <textarea
                className="w-full border rounded px-2 py-1 text-sm resize-none min-h-[70px]"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Optional note for this revision..."
                dir="rtl"
            />

            <SectionTitle title="Images" />
            <div className="space-y-4">
                <ImageGeneratorPanel
                    projectId={projectId}
                    entityType="projectItem"
                    entityId={String(item._id)}
                    defaultPrompt={`${identity.title} (${identity.typeKey}) render`}
                />
                <ImagePicker projectId={projectId} entityType="projectItem" entityId={String(item._id)} />
            </div>

            <ItemDetailDrawer
                itemId={item._id}
                open={showDetails}
                onClose={() => setShowDetails(false)}
            />
        </div>
    );
}

function SectionTitle({ title }: { title: string }) {
    return <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{title}</div>;
}

