"use client";

import { useEffect, useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Plus, Wand2, Save, Pencil, Trash2, X } from "lucide-react";
import { type ProjectAccountingData, type ProjectAccountingSection } from "./AccountingTypes";

export default function LaborTab({ data, projectId }: { data: ProjectAccountingData, projectId: Id<"projects"> }) {
  const addWorkLine = useMutation(api.accounting.addWorkLine);
  const updateWorkLine = useMutation(api.accounting.updateWorkLine);
  const deleteWorkLine = useMutation(api.accounting.deleteWorkLine);
  const estimateSection = useAction(api.agents.estimator.run);

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
    await addWorkLine({
      projectId,
      sectionId,
      workType: "studio",
      role: "Art worker",
      rateType: "hour",
      plannedQuantity: 1,
      plannedUnitCost: 100,
      status: "planned"
    });
  };

  const handleDeleteLine = async (lineId: Id<"workLines">) => {
    if (!confirm("Delete this labor line?")) return;
    await deleteWorkLine({ id: lineId });
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
                {data.sections.map((s) => (
                    <option key={s.section._id} value={s.section._id}>{s.section.name}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="space-y-6">
        {filteredSections.map((item) => {
            const { section, work } = item;
            return (
                <div key={section._id} className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                        <h3 className="font-medium text-gray-700">{section.name}</h3>
                         <div className="flex space-x-2">
                             <button 
                                className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded flex items-center hover:bg-purple-200 disabled:opacity-50"
                                onClick={() => handleEstimate(section._id)}
                                disabled={estimatingIds.has(section._id)}
                             >
                                <Wand2 className={`w-3 h-3 mr-1 ${estimatingIds.has(section._id) ? "animate-spin" : ""}`} /> 
                                {estimatingIds.has(section._id) ? "Estimating..." : "Auto-Estimate"}
                             </button>
                             <button 
                                onClick={() => handleAddLine(section._id)}
                                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 flex items-center"
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
                                            key={w._id} 
                                            line={w} 
                                            update={updateWorkLine} 
                                            onDelete={() => handleDeleteLine(w._id)}
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
}: {
    line: Doc<"workLines">;
    update: (args: {
        id: Id<"workLines">;
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
        };
    }) => Promise<void>;
    onDelete: () => void;
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
            id: line._id,
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
                        >
                            <Pencil className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                        onClick={onDelete}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </td>
        </tr>
    );
}
