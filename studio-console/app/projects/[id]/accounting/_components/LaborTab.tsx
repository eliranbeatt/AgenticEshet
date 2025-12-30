"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { Plus, Wand2, Save, Pencil, Trash2, X, Lock, Unlock } from "lucide-react";
import { type ProjectAccountingData, type ProjectAccountingSection } from "./AccountingTypes";
import { type CostingOptions } from "@/src/lib/costing";
import type { ElementSnapshot } from "@/convex/lib/zodSchemas";

type WorkLineView = {
  id: string;
  laborKey: string;
  itemId?: Id<"projectItems">;
  itemLaborId?: string;
  workType?: string;
  role: string;
  rateType: string;
  plannedQuantity: number;
  plannedUnitCost: number;
  actualQuantity?: number;
  actualUnitCost?: number;
  status?: string;
  description?: string;
  quoteVisibility?: "include" | "exclude" | "optional";
  isManagement?: boolean;
  generation?: Doc<"workLines">["generation"];
  lock?: boolean;
  isPreview: boolean;
};

export default function LaborTab({
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
  const addWorkLine = useMutation(api.accounting.addWorkLine);
  const updateWorkLine = useMutation(api.accounting.updateWorkLine);
  const deleteWorkLine = useMutation(api.accounting.deleteWorkLine);
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

  const buildLaborValue = (line: WorkLineView) => ({
    laborKey: line.laborKey || createElementKey("lab"),
    role: line.role,
    qty: line.plannedQuantity,
    unit: line.rateType,
    rate: line.plannedUnitCost,
    bucketKey: line.workType ?? "studio",
    notes: line.description ?? undefined,
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
    const itemLaborId = createElementKey("lab");
    if (draftOnlyMode && draftRevisionId && elementId) {
        const element = elementsById.get(String(elementId));
        const baseVersionId = element?.publishedVersionId ?? undefined;
        const value = {
            laborKey: itemLaborId,
            role: "Art worker",
            qty: 1,
            unit: "hour",
            rate: 100,
            bucketKey: "studio",
            notes: undefined,
        };
        await patchElement({
            revisionId: draftRevisionId,
            elementId,
            baseVersionId,
            patchOps: [{ op: "upsert_line", entity: "labor", key: value.laborKey, value }],
        });
        return;
    }

    await addWorkLine({
      projectId,
      sectionId,
      itemId: elementId,
      itemLaborId,
      workType: "studio",
      role: "Art worker",
      rateType: "hour",
      plannedQuantity: 1,
      plannedUnitCost: 100,
      status: "planned",
    });
  };

  const handleDeleteLine = async (line: WorkLineView) => {
    if (!confirm("Delete this labor line?")) return;
    if (draftOnlyMode && !draftRevisionId) {
        alert("Draft edits require an active draft.");
        return;
    }
    if (draftOnlyMode && draftRevisionId) {
        if (!line.itemId || !line.itemLaborId) {
            alert("Draft edits require a linked element and labor key.");
            return;
        }
        const element = elementsById.get(String(line.itemId));
        const baseVersionId = element?.publishedVersionId ?? undefined;
        await patchElement({
            revisionId: draftRevisionId,
            elementId: line.itemId,
            baseVersionId,
            patchOps: [{ op: "remove_line", entity: "labor", key: line.itemLaborId, reason: "User deleted line" }],
        });
        return;
    }

    await deleteWorkLine({ id: line.id as Id<"workLines"> });
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2">
            <h2 className="text-lg font-semibold">Labor Tracking</h2>
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
            const workViews: WorkLineView[] = draftOnlyMode && previewSnapshot
                ? previewSnapshot.labor.map((line) => ({
                    id: line.laborKey,
                    laborKey: line.laborKey,
                    itemId: section.itemId ?? undefined,
                    itemLaborId: line.laborKey,
                    workType: line.bucketKey,
                    role: line.role,
                    rateType: line.unit,
                    plannedQuantity: line.qty,
                    plannedUnitCost: line.rate,
                    status: "planned",
                    description: line.notes,
                    quoteVisibility: "include",
                    isManagement: false,
                    generation: "generated",
                    lock: false,
                    isPreview: true,
                }))
                : item.work.map((line) => ({
                    id: String(line._id),
                    laborKey: line.itemLaborId ?? String(line._id),
                    itemId: line.itemId ?? undefined,
                    itemLaborId: line.itemLaborId ?? undefined,
                    workType: line.workType,
                    role: line.role,
                    rateType: line.rateType,
                    plannedQuantity: line.plannedQuantity,
                    plannedUnitCost: line.plannedUnitCost,
                    actualQuantity: line.actualQuantity,
                    actualUnitCost: line.actualUnitCost,
                    status: line.status,
                    description: line.description,
                    quoteVisibility: line.quoteVisibility,
                    isManagement: line.isManagement,
                    generation: line.generation,
                    lock: line.lock,
                    isPreview: false,
                }));

            const work = workViews.filter((line) => {
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
                                <Plus className="w-3 h-3 mr-1" /> Add Task
                             </button>
                        </div>
                    </div>
                    
                    {work.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm">No labor tasks listed.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-white">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Task / Role</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate Type</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Visibility</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Qty</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Rate</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Qty</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Rate</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gap</th>
                                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {work.map((w) => (
                                        <WorkRow 
                                            key={w.laborKey} 
                                            line={w} 
                                            update={async (args) => {
                                                if (draftOnlyMode && !draftRevisionId) {
                                                    alert("Draft edits require an active draft.");
                                                    return;
                                                }
                                                if (draftOnlyMode && draftRevisionId) {
                                                    const elementId = w.itemId;
                                                    if (!elementId) {
                                                        alert("Draft edits require a linked element.");
                                                        return;
                                                    }
                                                    const element = elementsById.get(String(elementId));
                                                    const baseVersionId = element?.publishedVersionId ?? undefined;
                                                    const nextLine = { ...w, ...args.updates };
                                                    const laborKey = nextLine.laborKey || createElementKey("lab");
                                                    const value = buildLaborValue({ ...nextLine, laborKey });
                                                    await patchElement({
                                                        revisionId: draftRevisionId,
                                                        elementId,
                                                        baseVersionId,
                                                        patchOps: [{ op: "upsert_line", entity: "labor", key: laborKey, value }],
                                                    });
                                                    return;
                                                }

                                                await updateWorkLine({
                                                    id: args.id as Id<"workLines">,
                                                    updates: args.updates,
                                                });
                                            }}
                                            onDelete={() => handleDeleteLine(w)}
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

function WorkRow({
    line,
    update,
    onDelete,
    allowInlineEdits,
    allowLockToggle,
}: {
    line: WorkLineView;
    update: (args: {
        id: string;
        updates: {
            workType?: string;
            role?: string;
            rateType?: string;
            plannedQuantity?: number;
            plannedUnitCost?: number;
            actualQuantity?: number;
            actualUnitCost?: number;
            status?: string;
            description?: string;
            lock?: boolean;
        };
    }) => Promise<void>;
    onDelete: () => void;
    allowInlineEdits: boolean;
    allowLockToggle: boolean;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState({
        role: line.role,
        description: line.description ?? "",
        rateType: line.rateType,
        plannedQuantity: line.plannedQuantity.toString(),
        plannedUnitCost: line.plannedUnitCost.toString(),
        actualQuantity: line.actualQuantity?.toString() ?? "",
        actualUnitCost: line.actualUnitCost?.toString() ?? "",
        workType: line.workType ?? "studio",
        status: line.status ?? "",
    });

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
            role: line.role,
            description: line.description ?? "",
            rateType: line.rateType,
            plannedQuantity: line.plannedQuantity.toString(),
            plannedUnitCost: line.plannedUnitCost.toString(),
            actualQuantity: line.actualQuantity?.toString() ?? "",
            actualUnitCost: line.actualUnitCost?.toString() ?? "",
            workType: line.workType ?? "studio",
            status: line.status ?? "",
        });
        setIsEditing(false);
    }, [line]);

    const parseNumber = (value: string, fallback: number) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const visibility = line.quoteVisibility ?? "include";
    const plannedQty = draft.rateType === "flat" ? 1 : parseNumber(draft.plannedQuantity, line.plannedQuantity);
    const plannedRate = parseNumber(draft.plannedUnitCost, line.plannedUnitCost);
    const plannedTotal = draft.rateType === "flat" ? plannedRate : plannedQty * plannedRate;

    const actQty = draft.rateType === "flat" ? 1 : (draft.actualQuantity ? parseNumber(draft.actualQuantity, line.plannedQuantity) : undefined);
    const actRate = draft.actualUnitCost ? parseNumber(draft.actualUnitCost, line.plannedUnitCost) : undefined;
    const actualTotal = draft.rateType === "flat"
        ? (actRate ?? plannedRate)
        : ((actQty ?? plannedQty) * (actRate ?? plannedRate));

    const gap = actualTotal - plannedTotal;
    const isOverBudget = gap > 0;

    const handleSave = async () => {
        await update({
            id: line.id,
            updates: {
                role: draft.role || line.role,
                description: draft.description || undefined,
                rateType: draft.rateType,
                plannedQuantity: draft.rateType === "flat" ? 1 : plannedQty,
                plannedUnitCost: plannedRate,
                actualQuantity: draft.rateType === "flat" ? undefined : (draft.actualQuantity ? parseNumber(draft.actualQuantity, line.plannedQuantity) : undefined),
                actualUnitCost: draft.actualUnitCost ? parseNumber(draft.actualUnitCost, line.plannedUnitCost) : undefined,
                status: draft.status || line.status,
                workType: draft.workType,
            },
        });
        setIsEditing(false);
    };

    const handleCancel = () => {
        setDraft({
            role: line.role,
            description: line.description ?? "",
            rateType: line.rateType,
            plannedQuantity: line.plannedQuantity.toString(),
            plannedUnitCost: line.plannedUnitCost.toString(),
            actualQuantity: line.actualQuantity?.toString() ?? "",
            actualUnitCost: line.actualUnitCost?.toString() ?? "",
            workType: line.workType ?? "studio",
            status: line.status ?? "",
        });
        setIsEditing(false);
    };

    const plannedQuantityCell = draft.rateType === "flat" ? <span className="text-xs text-gray-500">-</span> : (
        isEditing ? (
            <input
                type="number"
                className="w-16 text-right bg-transparent border px-2 py-1 rounded text-sm"
                value={draft.plannedQuantity}
                onChange={(e) => setDraft((prev) => ({ ...prev, plannedQuantity: e.target.value }))}
            />
        ) : (
            plannedQty
        )
    );

    const actualQuantityCell = draft.rateType === "flat" ? <span className="text-xs text-gray-500">-</span> : (
        isEditing ? (
            <input
                type="number"
                className="w-16 text-right bg-transparent border px-2 py-1 rounded text-sm"
                placeholder={line.plannedQuantity.toString()}
                value={draft.actualQuantity}
                onChange={(e) => setDraft((prev) => ({ ...prev, actualQuantity: e.target.value }))}
            />
        ) : (
            actQty ?? <span className="text-xs text-gray-400">-</span>
        )
    );

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                {isEditing ? (
                    <div className="flex flex-col gap-1">
                        <input
                            className="w-full bg-transparent border px-2 py-1 rounded font-medium"
                            value={draft.role}
                            onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value }))}
                        />
                        <input
                            className="w-full bg-transparent border px-2 py-1 rounded text-xs text-gray-700"
                            value={draft.description}
                            onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                            placeholder="Description..."
                        />
                    </div>
                ) : (
                    <>
                        <div className="font-medium">{line.role}</div>
                        <div className="text-xs text-gray-500">{line.description || "No description"}</div>
                    </>
                )}
            </td>
             <td className="px-3 py-2">
                 {isEditing ? (
                    <select
                        className="bg-transparent border px-2 py-1 rounded text-xs"
                        value={draft.rateType}
                        onChange={(e) => setDraft((prev) => ({ ...prev, rateType: e.target.value }))}
                    >
                        <option value="day">Day</option>
                        <option value="hour">Hour</option>
                        <option value="flat">Flat</option>
                    </select>
                 ) : (
                    <div className="text-sm text-gray-700 capitalize">{line.rateType}</div>
                 )}
            </td>
            
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            visibility === "exclude"
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
                    {line.generation && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-slate-600">
                            {line.generation}
                        </span>
                    )}
                    {line.lock && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                            locked
                        </span>
                    )}
                </div>
            </td>
                <td className="px-3 py-2 text-right bg-blue-50/30">
                {plannedQuantityCell}
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
                    plannedRate.toFixed(2)
                )}
            </td>

            <td className="px-3 py-2 text-right bg-green-50/30">
                {actualQuantityCell}
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
                    actRate?.toFixed(2) ?? <span className="text-xs text-gray-400">-</span>
                )}
            </td>

            <td className={`px-3 py-2 text-right font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                {gap.toFixed(2)}
            </td>
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    {isEditing ? (
                        <>
                            <button
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                                onClick={handleSave}
                            >
                                <Save className="w-4 h-4" />
                            </button>
                            <button
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                                onClick={handleCancel}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    ) : (
                        <button
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                            onClick={() => setIsEditing(true)}
                            disabled={!allowInlineEdits}
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-gray-500 hover:text-amber-600"
                        title={line.lock ? "Unlock line" : "Lock line"}
                        onClick={() => update({ id: line.id, updates: { lock: !line.lock } })}
                        disabled={!allowInlineEdits || !allowLockToggle}
                    >
                        {line.lock ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    </button>
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={onDelete}
                        disabled={!allowInlineEdits}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}
