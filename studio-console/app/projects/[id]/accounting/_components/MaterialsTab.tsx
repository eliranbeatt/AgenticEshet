"use client";

import { useEffect, useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Save, Plus, Wand2, Pencil, Trash2, X, ShoppingCart } from "lucide-react";
import { BuyingAssistantPanel } from "../../quote/_components/BuyingAssistantPanel";
import { type ProjectAccountingData, type ProjectAccountingSection } from "./AccountingTypes";

export default function MaterialsTab({ data, projectId }: { data: ProjectAccountingData, projectId: Id<"projects"> }) {
  const addMaterialLine = useMutation(api.accounting.addMaterialLine);
  const updateMaterialLine = useMutation(api.accounting.updateMaterialLine);
  const deleteMaterialLine = useMutation(api.accounting.deleteMaterialLine);
  const saveToCatalog = useMutation(api.accounting.saveToCatalog);
  const estimateSection = useAction(api.agents.estimator.run);
  const syncApproved = useMutation(api.items.syncApproved);
  const syncFromAccounting = useMutation(api.items.syncFromAccountingSection);

  const [filterSection, setFilterSection] = useState<string>("all");
  const [estimatingIds, setEstimatingIds] = useState<Set<string>>(new Set());

  const handleEstimate = async (sectionId: string) => {
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

  const filteredSections = filterSection === "all" 
    ? data.sections 
    : data.sections.filter((s: ProjectAccountingSection) => s.section._id === filterSection);

  const handleAddLine = async (sectionId: Id<"sections">) => {
    await addMaterialLine({
      projectId,
      sectionId,
      itemId: data.sections.find((s) => s.section._id === sectionId)?.section.itemId ?? undefined,
      category: "General",
      label: "New Material",
      unit: "unit",
      plannedQuantity: 1,
      plannedUnitCost: 0,
      status: "planned"
    });
  };

  const handleDeleteLine = async (lineId: Id<"materialLines">) => {
    if (!confirm("Delete this material line?")) return;
    await deleteMaterialLine({ id: lineId });
  };

  const handleSaveToCatalog = async (line: Doc<"materialLines">) => {
    await saveToCatalog({
      category: line.category,
      name: line.label,
      defaultUnit: line.unit,
      lastPrice: line.actualUnitCost || line.plannedUnitCost,
      vendorId: line.vendorId
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
                {data.sections.map((s) => (
                    <option key={s.section._id} value={s.section._id}>{s.section.name}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="space-y-6">
        {filteredSections.map((item) => {
            const { section, materials } = item;
            return (
                <div key={section._id} className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                        <div>
                            <h3 className="font-medium text-gray-700">{section.name}</h3>
                            {item.item && (
                                <div className="text-xs text-blue-600">Item: {item.item.title}</div>
                            )}
                        </div>
                        <div className="flex space-x-2">
                             <button 
                                className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded flex items-center hover:bg-purple-200 disabled:opacity-50"
                                title="Use AI to estimate materials"
                                onClick={() => handleEstimate(section._id)}
                                disabled={estimatingIds.has(section._id)}
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
                                    >
                                        Sync from accounting
                                    </button>
                                    <button
                                        className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                                        onClick={() => syncApproved({ itemId: item.item!._id })}
                                        title="Sync accounting from item"
                                    >
                                        Sync to accounting
                                    </button>
                                </>
                             )}
                             <button 
                                onClick={() => handleAddLine(section._id)}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 flex items-center"
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
                                            key={m._id} 
                                            line={m} 
                                            update={async (args) => {
                                                await updateMaterialLine(args);
                                            }}
                                            onSaveCatalog={() => handleSaveToCatalog(m)}
                                            onDelete={() => handleDeleteLine(m._id)}
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
}: {
    line: Doc<"materialLines">;
    update: (args: {
        id: Id<"materialLines">;
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
        };
    }) => Promise<void>;
    onSaveCatalog: () => void;
    onDelete: () => void;
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
            id: line._id,
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
                id: line._id,
                updates: { procurement: next },
            });
        }
    };

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
                            >
                                <Pencil className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            onClick={() => setShowAssistant(!showAssistant)}
                            className={`hover:text-blue-600 ${showAssistant ? "text-blue-600" : "text-gray-500"}`}
                            title="Buying Assistant"
                        >
                            <ShoppingCart className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onSaveCatalog}
                            className="text-gray-500 hover:text-blue-600"
                            title="Save to Catalog"
                        >
                            <Save className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onDelete}
                            className="text-red-500 hover:text-red-600"
                            title="Delete line"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </td>
            </tr>
            {showAssistant && (
                <tr>
                    <td colSpan={9} className="bg-gray-50 p-0">
                        <div className="p-4 border-b border-gray-200 shadow-inner">
                            <BuyingAssistantPanel materialLineId={line._id} label={line.label} />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
