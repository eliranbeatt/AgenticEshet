"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { Save, Plus, Wand2, Pencil, Trash2, X, ShoppingCart, Lock, Unlock } from "lucide-react";
import { BuyingAssistantPanel } from "../../quote/_components/BuyingAssistantPanel";
import { type ProjectAccountingData, type ProjectAccountingSection } from "./AccountingTypes";
import { type CostingOptions } from "@/src/lib/costing";
import type { ElementSnapshot } from "@/convex/lib/zodSchemas";

type MaterialLineView = {
    id: string;
    materialKey: string;
    itemId?: Id<"projectItems">;
    itemMaterialId?: string;
    label: string;
    category?: string;
    description?: string;
    procurement?: "in_stock" | "local" | "abroad" | "either";
    vendorName?: string;
    unit: string;
    plannedQuantity: number;
    plannedUnitCost: number;
    actualQuantity?: number;
    actualUnitCost?: number;
    status?: string;
    note?: string;
    quoteVisibility?: "include" | "exclude" | "optional";
    isManagement?: boolean;
    origin?: Doc<"materialLines">["origin"];
    generation?: Doc<"materialLines">["generation"];
    lock?: boolean;
    isPreview: boolean;
};

export default function MaterialsTab({
    data,
    projectId,
    selectedElementId,
    includeManagement,
    includeOptional,
    respectVisibility,
    editMode,
    draftRevisionId,
    elementsById,
    allowInlineEdits,
}: {
    data: ProjectAccountingData;
    projectId: Id<"projects">;
    selectedElementId: Id<"projectItems"> | "unlinked" | null;
    includeManagement: boolean;
    includeOptional: boolean;
    respectVisibility: boolean;
    editMode: boolean;
    draftRevisionId: Id<"revisions"> | null;
    elementsById: Map<string, Doc<"projectItems">>;
    allowInlineEdits: boolean;
}) {
    const addMaterialLine = useMutation(api.accounting.addMaterialLine);
    const updateMaterialLine = useMutation(api.accounting.updateMaterialLine);
    const deleteMaterialLine = useMutation(api.accounting.deleteMaterialLine);
    const saveToCatalog = useMutation(api.accounting.saveToCatalog);
    const estimateSection = useAction(api.agents.estimator.run);
    const syncApproved = useMutation(api.items.syncApproved);
    const syncFromAccounting = useMutation(api.items.syncFromAccountingSection);
    const patchElement = useMutation(api.revisions.patchElement);

    const [filterSection, setFilterSection] = useState<string>("all");
    const [estimatingIds, setEstimatingIds] = useState<Set<string>>(new Set());
    const draftOnlyMode = Boolean(editMode);
    const allowInlineEditsSafe = allowInlineEdits && (!editMode || Boolean(draftRevisionId));

    const elementIds = useMemo(() => {
        const ids = new Set<string>();
        data.sections.forEach((entry) => {
            if (entry.section.itemId) ids.add(String(entry.section.itemId));
        });
        return Array.from(ids) as Id<"projectItems">[];
    }, [data.sections]);

    const previewSnapshots = useQuery(
        api.revisions.previewSnapshots,
        draftOnlyMode && draftRevisionId ? { revisionId: draftRevisionId, elementIds } : "skip",
    ) as Array<{ elementId: Id<"projectItems">; snapshot: ElementSnapshot }> | undefined;

    const previewByElementId = useMemo(() => {
        const map = new Map<string, ElementSnapshot>();
        (previewSnapshots ?? []).forEach((entry) => {
            map.set(String(entry.elementId), entry.snapshot);
        });
        return map;
    }, [previewSnapshots]);

    const createElementKey = (prefix: "mat" | "lab" | "tsk") => {
        const suffix = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
        return `${prefix}_${suffix}`;
    };

    const buildMaterialValue = (line: MaterialLineView) => ({
        materialKey: line.materialKey || createElementKey("mat"),
        name: line.label,
        spec: line.description ?? "",
        qty: line.plannedQuantity,
        unit: line.unit,
        unitCost: line.plannedUnitCost,
        bucketKey: line.category ?? "General",
        needPurchase: (line.procurement ?? "either") !== "in_stock",
        vendorRef: line.vendorName ?? undefined,
        notes: line.note ?? undefined,
    });

    const handleEstimate = async (sectionId: string) => {
        if (draftOnlyMode) {
            alert("Auto-estimate is disabled while editing a draft. Approve the draft first.");
            return;
        }
        if (!confirm("This will generate new material and labor lines using AI. Continue?")) return;
        setEstimatingIds(prev => new Set(prev).add(sectionId));
        try {
            await estimateSection({ projectId, sectionId: sectionId as Id<"sections"> });
            alert("Estimation started in the background. Lines will appear shortly.");
        } catch (e) {
            alert("Estimation failed: " + e);
        } finally {
            setEstimatingIds(prev => {
                const next = new Set(prev);
                next.delete(sectionId);
                return next;
            });
        }
    };

    const baseSections = selectedElementId
        ? data.sections.filter((s) =>
            selectedElementId === "unlinked"
                ? !s.section.itemId
                : s.section.itemId === selectedElementId
        )
        : data.sections;

    const options: CostingOptions = { includeManagement, includeOptional, respectVisibility };

    const filteredSections =
        filterSection === "all"
            ? baseSections
            : baseSections.filter((s: ProjectAccountingSection) => s.section._id === filterSection);

    const handleAddLine = async (sectionId: Id<"sections">) => {
        const elementId = data.sections.find((s) => s.section._id === sectionId)?.section.itemId ?? undefined;
        if (editMode && (!draftRevisionId || !elementId)) {
            alert("Draft edits require a linked element.");
            return;
        }
        const itemMaterialId = createElementKey("mat");
        if (draftOnlyMode && draftRevisionId && elementId) {
            const element = elementsById.get(String(elementId));
            const baseVersionId = element?.publishedVersionId ?? undefined;
            const value = {
                materialKey: itemMaterialId,
                name: "New Material",
                spec: "",
                qty: 1,
                unit: "unit",
                unitCost: 0,
                bucketKey: "General",
                needPurchase: true,
                vendorRef: undefined,
                notes: undefined,
            };
            await patchElement({
                revisionId: draftRevisionId,
                elementId,
                baseVersionId,
                patchOps: [{ op: "upsert_line", entity: "materials", key: value.materialKey, value }],
            });
            return;
        }

        await addMaterialLine({
            projectId,
            sectionId,
            itemId: elementId,
            itemMaterialId,
            category: "General",
            label: "New Material",
            unit: "unit",
            plannedQuantity: 1,
            plannedUnitCost: 0,
            status: "planned",
        });
    };

    const handleDeleteLine = async (line: MaterialLineView) => {
        if (!confirm("Delete this material line?")) return;
        if (draftOnlyMode && !draftRevisionId) {
            alert("Draft edits require an active draft.");
            return;
        }
        if (draftOnlyMode && draftRevisionId) {
            if (!line.itemId || !line.itemMaterialId) {
                alert("Draft edits require a linked element and material key.");
                return;
            }
            const element = elementsById.get(String(line.itemId));
            const baseVersionId = element?.publishedVersionId ?? undefined;
            await patchElement({
                revisionId: draftRevisionId,
                elementId: line.itemId,
                baseVersionId,
                patchOps: [{ op: "remove_line", entity: "materials", key: line.itemMaterialId, reason: "User deleted line" }],
            });
            return;
        }

        await deleteMaterialLine({ id: line.id as Id<"materialLines"> });
    };

    const handleSaveToCatalog = async (line: MaterialLineView) => {
        if (draftOnlyMode) {
            alert("Catalog saves are disabled while editing a draft.");
            return;
        }
        await saveToCatalog({
            category: line.category ?? "General",
            name: line.label,
            defaultUnit: line.unit,
            lastPrice: line.actualUnitCost || line.plannedUnitCost,
        });
        alert("Saved to catalog!");
    };

    return (
        <div className="flex flex-col space-y-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-semibold">Materials Tracking</h2>
                    <select
                        className="border rounded p-1 text-sm"
                        value={filterSection}
                        onChange={(e) => setFilterSection(e.target.value)}
                    >
                        <option value="all">All Sections</option>
                        {baseSections.map((s) => (
                            <option key={s.section._id} value={s.section._id}>{s.section.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="space-y-6">
                {filteredSections.map((item) => {
                    const { section } = item;
                    const previewSnapshot = section.itemId ? previewByElementId.get(String(section.itemId)) : undefined;
                    const materialViews: MaterialLineView[] = draftOnlyMode && previewSnapshot
                        ? previewSnapshot.materials.map((line) => ({
                            id: line.materialKey,
                            materialKey: line.materialKey,
                            itemId: section.itemId ?? undefined,
                            itemMaterialId: line.materialKey,
                            label: line.name,
                            category: line.bucketKey,
                            description: line.spec,
                            procurement: line.needPurchase ? "local" : "in_stock",
                            vendorName: line.vendorRef,
                            unit: line.unit,
                            plannedQuantity: line.qty,
                            plannedUnitCost: line.unitCost ?? 0,
                            status: "planned",
                            note: line.notes,
                            quoteVisibility: "include",
                            isManagement: false,
                            generation: "generated",
                            lock: false,
                            isPreview: true,
                        }))
                        : item.materials.map((line) => ({
                            id: String(line._id),
                            materialKey: line.itemMaterialId ?? String(line._id),
                            itemId: line.itemId ?? undefined,
                            itemMaterialId: line.itemMaterialId ?? undefined,
                            label: line.label,
                            category: line.category,
                            description: line.description,
                            procurement: line.procurement,
                            vendorName: line.vendorName,
                            unit: line.unit,
                            plannedQuantity: line.plannedQuantity,
                            plannedUnitCost: line.plannedUnitCost,
                            actualQuantity: line.actualQuantity,
                            actualUnitCost: line.actualUnitCost,
                            status: line.status,
                            note: line.note,
                            quoteVisibility: line.quoteVisibility,
                            isManagement: line.isManagement,
                            origin: line.origin,
                            generation: line.generation,
                            lock: line.lock,
                            isPreview: false,
                        }));

                    const materials = materialViews.filter((line) => {
                        if (!options.includeManagement && line.isManagement) return false;
                        if (!options.respectVisibility) return true;
                        const visibility = line.quoteVisibility ?? "include";
                        if (visibility === "exclude") return false;
                        if (visibility === "optional" && !options.includeOptional) return false;
                        return true;
                    });
                    return (
                        <div key={section._id} className="border rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium text-gray-700">{section.name}</h3>
                                    {item.item && (
                                        <div className="text-xs text-blue-600">Element: {item.item.title}</div>
                                    )}
                                </div>
                                <div className="flex space-x-2">
                                    <button
                                        className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded flex items-center hover:bg-purple-200 disabled:opacity-50"
                                        title="Use AI to estimate materials"
                                        onClick={() => handleEstimate(section._id)}
                                        disabled={estimatingIds.has(section._id) || draftOnlyMode}
                                    >
                                        <Wand2 className={`w-3 h-3 mr-1 ${estimatingIds.has(section._id) ? "animate-spin" : ""}`} />
                                        {estimatingIds.has(section._id) ? "Estimating..." : "Auto-Estimate"}
                                    </button>
                                    {item.item && (
                                        <>
                                            <button
                                                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                                                onClick={() => syncFromAccounting({ itemId: item.item!._id, sectionId: section._id })}
                                                title="Sync item from accounting"
                                                disabled={draftOnlyMode}
                                            >
                                                Sync from accounting
                                            </button>
                                            <button
                                                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                                                onClick={() => syncApproved({ itemId: item.item!._id })}
                                                title="Sync accounting from item"
                                                disabled={draftOnlyMode}
                                            >
                                                Sync to accounting
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={() => handleAddLine(section._id)}
                                        className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 flex items-center disabled:opacity-50"
                                        disabled={!allowInlineEditsSafe}
                                    >
                                        <Plus className="w-3 h-3 mr-1" /> Add Item
                                    </button>
                                </div>
                            </div>

                            {materials.length === 0 ? (
                                <div className="p-4 text-center text-gray-400 text-sm">No materials listed.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                                        <thead className="bg-white">
                                            <tr>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Procurement</th>
                                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Visibility</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Qty</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Cost</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Qty</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Cost</th>
                                                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gap</th>
                                                <th className="px-3 py-2 w-28 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 bg-white">
                                    {materials.map((m) => (
                                        <MaterialRow
                                                    key={m.materialKey}
                                                    line={m}
                                                    update={async (args) => {
                                                        if (draftOnlyMode && !draftRevisionId) {
                                                            alert("Draft edits require an active draft.");
                                                            return;
                                                        }
                                                        if (draftOnlyMode && draftRevisionId) {
                                                            const elementId = m.itemId;
                                                            if (!elementId) {
                                                                alert("Draft edits require a linked element.");
                                                                return;
                                                            }
                                                            const element = elementsById.get(String(elementId));
                                                            const baseVersionId = element?.publishedVersionId ?? undefined;
                                                            const nextLine = { ...m, ...args.updates };
                                                            const materialKey = nextLine.materialKey || createElementKey("mat");
                                                            const value = buildMaterialValue({ ...nextLine, materialKey });
                                                            await patchElement({
                                                                revisionId: draftRevisionId,
                                                                elementId,
                                                                baseVersionId,
                                                                patchOps: [{ op: "upsert_line", entity: "materials", key: materialKey, value }],
                                                            });
                                                            return;
                                                        }

                                                        await updateMaterialLine({
                                                            id: args.id as Id<"materialLines">,
                                                            updates: args.updates,
                                                        });
                                                    }}
                                                    onSaveCatalog={() => handleSaveToCatalog(m)}
                                                    onDelete={() => handleDeleteLine(m)}
                                                    allowInlineEdits={allowInlineEditsSafe}
                                                    allowLockToggle={!draftOnlyMode}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function MaterialRow({
    line,
    update,
    onSaveCatalog,
    onDelete,
    allowInlineEdits,
    allowLockToggle,
}: {
    line: MaterialLineView;
    update: (args: {
        id: string;
        updates: {
            category?: string;
            label?: string;
            description?: string;
            procurement?: "in_stock" | "local" | "abroad" | "either";
            vendorName?: string;
            unit?: string;
            plannedQuantity?: number;
            plannedUnitCost?: number;
            actualQuantity?: number;
            actualUnitCost?: number;
            status?: string;
            note?: string;
            lock?: boolean;
        };
    }) => Promise<void>;
    onSaveCatalog: () => void;
    onDelete: () => void;
    allowInlineEdits: boolean;
    allowLockToggle: boolean;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [showAssistant, setShowAssistant] = useState(false);
    const [draft, setDraft] = useState({
        label: line.label,
        category: line.category,
        vendorName: line.vendorName ?? "",
        procurement: line.procurement ?? "either",
        unit: line.unit,
        plannedQuantity: line.plannedQuantity.toString(),
        plannedUnitCost: line.plannedUnitCost.toString(),
        actualQuantity: line.actualQuantity?.toString() ?? "",
        actualUnitCost: line.actualUnitCost?.toString() ?? "",
        status: line.status ?? "",
        description: line.description ?? "",
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            label: line.label,
            category: line.category,
            vendorName: line.vendorName ?? "",
            procurement: line.procurement ?? "either",
            unit: line.unit,
            plannedQuantity: line.plannedQuantity.toString(),
            plannedUnitCost: line.plannedUnitCost.toString(),
            actualQuantity: line.actualQuantity?.toString() ?? "",
            actualUnitCost: line.actualUnitCost?.toString() ?? "",
            status: line.status ?? "",
            description: line.description ?? "",
        });
        setIsEditing(false);
    }, [line]);

    const parseNumber = (value: string, fallback: number) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const plannedQty = parseNumber(draft.plannedQuantity || "0", line.plannedQuantity);
    const plannedCost = parseNumber(draft.plannedUnitCost || "0", line.plannedUnitCost);
    const actualQty = draft.actualQuantity ? parseNumber(draft.actualQuantity, line.plannedQuantity) : undefined;
    const actualCost = draft.actualUnitCost ? parseNumber(draft.actualUnitCost, line.plannedUnitCost) : undefined;

    const plannedTotal = plannedQty * plannedCost;
    const actualTotal = (actualQty ?? plannedQty) * (actualCost ?? plannedCost);
    const gap = actualTotal - plannedTotal;
    const isOverBudget = gap > 0;

    const handleSave = async () => {
        await update({
            id: line.id,
            updates: {
                label: draft.label || line.label,
                category: draft.category || "General",
                vendorName: draft.vendorName || undefined,
                procurement: draft.procurement || line.procurement || "either",
                unit: draft.unit || line.unit,
                plannedQuantity: plannedQty,
                plannedUnitCost: plannedCost,
                actualQuantity: draft.actualQuantity ? parseNumber(draft.actualQuantity, line.plannedQuantity) : undefined,
                actualUnitCost: draft.actualUnitCost ? parseNumber(draft.actualUnitCost, line.plannedUnitCost) : undefined,
                status: draft.status || line.status,
                description: draft.description || undefined,
            },
        });
        setIsEditing(false);
    };

    const handleCancel = () => {
        setDraft({
            label: line.label,
            category: line.category,
            vendorName: line.vendorName ?? "",
            procurement: line.procurement ?? "either",
            unit: line.unit,
            plannedQuantity: line.plannedQuantity.toString(),
            plannedUnitCost: line.plannedUnitCost.toString(),
            actualQuantity: line.actualQuantity?.toString() ?? "",
            actualUnitCost: line.actualUnitCost?.toString() ?? "",
            status: line.status ?? "",
            description: line.description ?? "",
        });
        setIsEditing(false);
    };

    const handleProcurementChange = async (next: "in_stock" | "local" | "abroad" | "either") => {
        setDraft((prev) => ({ ...prev, procurement: next }));
        if (!isEditing) {
            await update({
                id: line.id,
                updates: { procurement: next },
            });
        }
    };

    const visibility = line.quoteVisibility ?? "include";

    return (
        <>
            <tr className="hover:bg-gray-50">
                <td className="px-3 py-2">
                    {isEditing ? (
                        <div className="flex flex-col gap-1">
                            <input
                                className="w-full bg-transparent border px-2 py-1 rounded text-sm"
                                value={draft.label}
                                onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
                            />
                            <input
                                className="w-full bg-transparent border px-2 py-1 rounded text-xs"
                                value={draft.category}
                                onChange={(e) => setDraft((prev) => ({ ...prev, category: e.target.value }))}
                                placeholder="Category"
                            />
                        </div>
                    ) : (
                        <>
                            <div className="font-medium">{line.label}</div>
                            <div className="text-xs text-gray-500">{line.category}</div>
                            {line.description && <div className="text-xs text-gray-400">{line.description}</div>}
                        </>
                    )}
                </td>
                <td className="px-3 py-2">
                    {isEditing ? (
                        <input
                            className="w-full bg-transparent border px-2 py-1 rounded text-sm"
                            value={draft.vendorName}
                            placeholder="Vendor..."
                            onChange={(e) => setDraft((prev) => ({ ...prev, vendorName: e.target.value }))}
                        />
                    ) : (
                        <div className="text-sm text-gray-700">{line.vendorName || <span className="text-gray-400">-</span>}</div>
                    )}
                </td>
                <td className="px-3 py-2">
                    <select
                        className="w-full bg-transparent border px-2 py-1 rounded text-sm"
                        value={draft.procurement}
                        onChange={(e) => {
                            const next = e.target.value as "in_stock" | "local" | "abroad" | "either";
                            void handleProcurementChange(next);
                        }}
                        title="Procurement mode"
                    >
                        <option value="in_stock">In stock</option>
                        <option value="local">Buy locally (Israel)</option>
                        <option value="abroad">Order abroad</option>
                        <option value="either">Local or abroad</option>
                    </select>
                </td>
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        {line.origin?.source === "template" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 font-medium">
                                Template
                            </span>
                        )}
                        {line.origin?.source === "ai" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 font-medium">
                                AI
                            </span>
                        )}
                        {line.generation && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600 font-medium">
                                {line.generation}
                            </span>
                        )}
                        {line.lock && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-medium">
                                locked
                            </span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${visibility === "exclude"
                                ? "border-red-200 bg-red-50 text-red-700"
                                : visibility === "optional"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }`}>
                            {visibility}
                        </span>
                        {line.isManagement && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                                management
                            </span>
                        )}
                    </div>
                </td>
                <td className="px-3 py-2 text-right bg-blue-50/30">
                    {isEditing ? (
                        <input
                            type="number"
                            className="w-16 text-right bg-transparent border px-2 py-1 rounded text-sm"
                            value={draft.plannedQuantity}
                            onChange={(e) => setDraft((prev) => ({ ...prev, plannedQuantity: e.target.value }))}
                        />
                    ) : (
                        plannedQty
                    )}
                </td>
                <td className="px-3 py-2 text-right bg-blue-50/30">
                    {isEditing ? (
                        <input
                            type="number"
                            className="w-20 text-right bg-transparent border px-2 py-1 rounded text-sm"
                            value={draft.plannedUnitCost}
                            onChange={(e) => setDraft((prev) => ({ ...prev, plannedUnitCost: e.target.value }))}
                        />
                    ) : (
                        plannedCost.toFixed(2)
                    )}
                </td>

                <td className="px-3 py-2 text-right bg-green-50/30">
                    {isEditing ? (
                        <input
                            type="number"
                            className="w-16 text-right bg-transparent border px-2 py-1 rounded text-sm"
                            placeholder={line.plannedQuantity.toString()}
                            value={draft.actualQuantity}
                            onChange={(e) => setDraft((prev) => ({ ...prev, actualQuantity: e.target.value }))}
                        />
                    ) : (
                        actualQty ?? <span className="text-gray-400 text-xs">-</span>
                    )}
                </td>
                <td className="px-3 py-2 text-right bg-green-50/30">
                    {isEditing ? (
                        <input
                            type="number"
                            className="w-20 text-right bg-transparent border px-2 py-1 rounded text-sm"
                            placeholder={line.plannedUnitCost.toString()}
                            value={draft.actualUnitCost}
                            onChange={(e) => setDraft((prev) => ({ ...prev, actualUnitCost: e.target.value }))}
                        />
                    ) : (
                        actualCost?.toFixed(2) ?? <span className="text-gray-400 text-xs">-</span>
                    )}
                </td>

                <td className={`px-3 py-2 text-right font-medium ${isOverBudget ? "text-red-600" : "text-green-600"}`}>
                    {gap.toFixed(2)}
                </td>
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleSave}
                                    className="text-green-600 hover:text-green-700"
                                    title="Save changes"
                                >
                                    <Save className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleCancel}
                                    className="text-gray-500 hover:text-gray-700"
                                    title="Cancel"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="text-blue-600 hover:text-blue-700"
                                title="Edit line"
                                disabled={!allowInlineEdits}
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            onClick={() => setShowAssistant(!showAssistant)}
                            className={`hover:text-blue-600 ${showAssistant ? "text-blue-600" : "text-gray-500"}`}
                            title="Buying Assistant"
                            disabled={!allowInlineEdits}
                        >
                            <ShoppingCart className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onSaveCatalog}
                            className="text-gray-500 hover:text-blue-600"
                            title="Save to Catalog"
                            disabled={!allowInlineEdits}
                        >
                            <Save className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => update({ id: line.id, updates: { lock: !line.lock } })}
                            className="text-gray-500 hover:text-amber-600"
                            title={line.lock ? "Unlock line" : "Lock line"}
                            disabled={!allowInlineEdits || !allowLockToggle}
                        >
                            {line.lock ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onDelete}
                            className="text-red-500 hover:text-red-600"
                            title="Delete line"
                            disabled={!allowInlineEdits}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </td>
            </tr>
            {showAssistant && (
                <tr>
                    <td colSpan={10} className="bg-gray-50 p-0">
                        <div className="p-4 border-b border-gray-200 shadow-inner">
                            <BuyingAssistantPanel materialLineId={line._id} label={line.label} />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
