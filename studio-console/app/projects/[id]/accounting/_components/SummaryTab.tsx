"use client";

import { useEffect, useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Plus, Wand2, Pencil, Trash2, Save, X } from "lucide-react";
import { type ProjectAccountingData } from "./AccountingTypes";

export default function SummaryTab({ data, projectId }: { data: ProjectAccountingData, projectId: Id<"projects"> }) {
  const addSection = useMutation(api.accounting.addSection);
  const estimateProject = useAction(api.agents.estimator.estimateProject);
  const generateAccounting = useAction(api.agents.accountingGenerator.run);
  const startDeepResearch = useAction(api.agents.deepResearch.startProject);
  const updateProject = useMutation(api.projects.updateProject);
  const updateSection = useMutation(api.accounting.updateSection);
  const deleteSection = useMutation(api.accounting.deleteSection);
  const syncApproved = useMutation(api.items.syncApproved);
  const syncFromAccounting = useMutation(api.items.syncFromAccountingSection);

  const [newSectionGroup, setNewSectionGroup] = useState("General");
  const [newSectionName, setNewSectionName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isEstimatingAll, setIsEstimatingAll] = useState(false);
  const [isGeneratingFromPlan, setIsGeneratingFromPlan] = useState(false);
  const [isDeepEstimating, setIsDeepEstimating] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);

  const [riskPercent, setRiskPercent] = useState<number>(() => (data.project.riskPercent ?? 0.10) * 100);
  const [overheadPercent, setOverheadPercent] = useState<number>(() => (data.project.overheadPercent ?? 0.15) * 100);
  const [profitPercent, setProfitPercent] = useState<number>(() => (data.project.profitPercent ?? 0.30) * 100);

  const parsePercent = (value: number, fallback: number) => {
    if (Number.isNaN(value)) return fallback;
    if (value < 0) return 0;
    return value / 100;
  };

  const handleEstimateAll = async () => {
    if (!confirm("This will auto-estimate ALL sections in Hebrew/ILS based on the plan. This may take a minute. Continue?")) return;
    setIsEstimatingAll(true);
    try {
        await estimateProject({ projectId });
        alert("Full project estimation started in the background. You can navigate away; results will appear as sections update.");
    } catch (e) {
        alert("Estimation failed: " + e);
    } finally {
        setIsEstimatingAll(false);
    }
  };

  const handleGenerateFromPlan = async () => {
    if (!confirm("This will replace current Accounting sections with items extracted from the APPROVED plan. Continue?")) return;
    setIsGeneratingFromPlan(true);
    try {
        await generateAccounting({ projectId, replaceExisting: true });
        alert("Accounting generation started in the background. Refresh sections in a moment.");
    } catch (e) {
        alert("Generation failed: " + e);
    } finally {
        setIsGeneratingFromPlan(false);
    }
  };

  const handleSavePolicy = async () => {
    setIsSavingPolicy(true);
    try {
        await updateProject({
            projectId,
            riskPercent: parsePercent(riskPercent, data.project.riskPercent ?? 0.10),
            overheadPercent: parsePercent(overheadPercent, data.project.overheadPercent ?? 0.15),
            profitPercent: parsePercent(profitPercent, data.project.profitPercent ?? 0.30),
        });
    } catch (e) {
        alert("Failed to save margins: " + e);
    } finally {
        setIsSavingPolicy(false);
    }
  };

  const handleDeepEstimate = async () => {
    if (!confirm("This will run Gemini Deep Research on the entire approved plan and store results under the Deep-Research tab. Continue?")) return;
    setIsDeepEstimating(true);
    try {
        await startDeepResearch({ projectId });
        alert("Deep research started. Open the Deep-Research tab to track progress.");
    } catch (e) {
        alert("Deep research failed: " + e);
    } finally {
        setIsDeepEstimating(false);
    }
  };

  const handleAddSection = async () => {
    if (!newSectionName) return;
    await addSection({
      projectId,
      group: newSectionGroup,
      name: newSectionName,
      sortOrder: data.sections.length + 1,
      pricingMode: "estimated",
    });
    setNewSectionName("");
    setIsAdding(false);
  };

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: data.project.currency || 'ILS' }).format(amount);
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Cost Summary</h2>
        <div className="flex space-x-2">
            <button
                onClick={handleGenerateFromPlan}
                disabled={isGeneratingFromPlan}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center text-sm disabled:opacity-50"
            >
                {isGeneratingFromPlan ? "Generating..." : "Generate from Plan"}
            </button>
            <button
                onClick={handleDeepEstimate}
                disabled={isDeepEstimating}
                className="bg-gray-900 text-white px-3 py-1 rounded hover:bg-black flex items-center text-sm disabled:opacity-50"
            >
                {isDeepEstimating ? "Researching..." : "Deep-Estimate Project"}
            </button>
            <button 
                onClick={handleEstimateAll}
                disabled={isEstimatingAll}
                className="bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 flex items-center text-sm disabled:opacity-50"
            >
                <Wand2 className={`w-4 h-4 mr-1 ${isEstimatingAll ? 'animate-spin' : ''}`} /> 
                {isEstimatingAll ? "Estimating..." : "Auto-Estimate Project"}
            </button>
            <button 
                onClick={() => setIsAdding(!isAdding)}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center text-sm"
            >
                <Plus className="w-4 h-4 mr-1" /> Add Section
            </button>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Margins (defaults per project)</h3>
            <button
                onClick={handleSavePolicy}
                disabled={isSavingPolicy}
                className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-black disabled:opacity-50"
            >
                {isSavingPolicy ? "Saving..." : "Save"}
            </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
                <div className="text-xs font-medium text-gray-600 mb-1">Risk % (default 10)</div>
                <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                />
            </label>
            <label className="text-sm">
                <div className="text-xs font-medium text-gray-600 mb-1">Overhead % (default 15)</div>
                <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={overheadPercent}
                    onChange={(e) => setOverheadPercent(Number(e.target.value))}
                />
            </label>
            <label className="text-sm">
                <div className="text-xs font-medium text-gray-600 mb-1">Profit % (default 30)</div>
                <input
                    type="number"
                    className="w-full border rounded px-2 py-1"
                    value={profitPercent}
                    onChange={(e) => setProfitPercent(Number(e.target.value))}
                />
            </label>
        </div>
        <div className="text-xs text-gray-500">
            Client price per item = Direct cost + Risk + Overhead + Profit (all computed from cost).
        </div>
      </div>

      {isAdding && (
        <div className="flex space-x-2 items-end bg-gray-50 p-3 rounded border">
          <div>
            <label className="block text-xs font-medium text-gray-700">Group</label>
            <input 
              className="border rounded p-1 text-sm w-32" 
              value={newSectionGroup} 
              onChange={e => setNewSectionGroup(e.target.value)} 
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700">Section Name</label>
            <input 
              className="border rounded p-1 text-sm w-full" 
              value={newSectionName} 
              onChange={e => setNewSectionName(e.target.value)} 
              placeholder="e.g. Wall Construction"
            />
          </div>
          <button onClick={handleAddSection} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm">Save</button>
        </div>
      )}

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Group</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Section</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 bg-blue-50">Mat (E)</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 bg-green-50">Work (S)</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 bg-gray-100">Direct</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Overhead</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Risk</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500">Profit</th>
              <th className="px-3 py-2 text-right font-bold text-gray-900 bg-yellow-50">Client Price</th>
              <th className="px-3 py-2 text-right font-medium text-gray-500 w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.sections.map((item) => (
                <SectionRow
                    key={item.section._id}
                    item={item}
                    formatMoney={formatMoney}
                    onUpdate={async (args) => {
                        await updateSection(args);
                    }}
                    onDelete={async (args) => {
                        await deleteSection(args);
                    }}
                    onSyncToItem={async ({ itemId }) => {
                        await syncApproved({ itemId });
                    }}
                    onSyncFromAccounting={async ({ itemId, sectionId }) => {
                        await syncFromAccounting({ itemId, sectionId });
                    }}
                />
            ))}
            {/* Totals Row */}
            <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
              <td className="px-3 py-2" colSpan={2}>TOTALS</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((sum, i) => sum + i.stats.plannedMaterialsCostE, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((sum, i) => sum + i.stats.plannedWorkCostS, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.totals.plannedDirect)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((sum, i) => sum + i.stats.plannedOverhead, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((sum, i) => sum + i.stats.plannedRisk, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((sum, i) => sum + i.stats.plannedProfit, 0))}</td>
              <td className="px-3 py-2 text-right bg-yellow-100">{formatMoney(data.totals.plannedClientPrice)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionRow(props: {
    item: ProjectAccountingData["sections"][number];
    formatMoney: (amount: number) => string;
    onUpdate: (args: {
        id: Id<"sections">;
        updates: {
            name?: string;
            group?: string;
            description?: string;
            sortOrder?: number;
            pricingMode?: "estimated" | "actual" | "mixed";
            overheadPercentOverride?: number;
            riskPercentOverride?: number;
            profitPercentOverride?: number;
        };
    }) => Promise<void>;
    onDelete: (args: { id: Id<"sections"> }) => Promise<void>;
    onSyncToItem: (args: { itemId: Id<"projectItems"> }) => Promise<void>;
    onSyncFromAccounting: (args: { itemId: Id<"projectItems">; sectionId: Id<"sections"> }) => Promise<void>;
}) {
    const { item, formatMoney, onUpdate, onDelete, onSyncToItem, onSyncFromAccounting } = props;
    const { section, stats } = item;

    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [draft, setDraft] = useState(() => ({
        group: section.group,
        name: section.name,
        description: section.description ?? "",
        sortOrder: section.sortOrder.toString(),
    }));

    useEffect(() => {
        setDraft({
            group: section.group,
            name: section.name,
            description: section.description ?? "",
            sortOrder: section.sortOrder.toString(),
        });
        setIsEditing(false);
    }, [section._id, section.group, section.name, section.description, section.sortOrder]);

    const parseNumber = (value: string, fallback: number) => {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onUpdate({
                id: section._id,
                updates: {
                    group: draft.group || section.group,
                    name: draft.name || section.name,
                    description: draft.description.trim() ? draft.description.trim() : undefined,
                    sortOrder: parseNumber(draft.sortOrder, section.sortOrder),
                },
            });
            setIsEditing(false);
        } catch (e) {
            alert("Failed to update section: " + e);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Delete this section (and all its materials & labor lines)?")) return;
        setIsDeleting(true);
        try {
            await onDelete({ id: section._id });
        } catch (e) {
            alert("Failed to delete section: " + e);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <tr className="hover:bg-gray-50 group">
            <td className="px-3 py-2 text-gray-500">
                {isEditing ? (
                    <input
                        className="w-full bg-transparent border px-2 py-1 rounded text-sm"
                        value={draft.group}
                        onChange={(e) => setDraft((prev) => ({ ...prev, group: e.target.value }))}
                    />
                ) : (
                    section.group
                )}
            </td>
            <td className="px-3 py-2 font-medium">
                {isEditing ? (
                    <div className="flex flex-col gap-1">
                        <input
                            className="w-full bg-transparent border px-2 py-1 rounded text-sm font-medium"
                            value={draft.name}
                            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                        />
                        <input
                            className="w-full bg-transparent border px-2 py-1 rounded text-xs"
                            placeholder="Description (optional)"
                            value={draft.description}
                            onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col">
                        <span>{section.name}</span>
                        {section.description && <span className="text-xs text-gray-500">{section.description}</span>}
                        {item.item && (
                            <span className="text-xs text-blue-600">Item: {item.item.title}</span>
                        )}
                    </div>
                )}
            </td>
            <td className="px-3 py-2 text-right bg-blue-50/50">{formatMoney(stats.plannedMaterialsCostE)}</td>
            <td className="px-3 py-2 text-right bg-green-50/50">{formatMoney(stats.plannedWorkCostS)}</td>
            <td className="px-3 py-2 text-right bg-gray-50 font-medium">{formatMoney(stats.plannedDirectCost)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedOverhead)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedRisk)}</td>
            <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedProfit)}</td>
            <td className="px-3 py-2 text-right font-bold bg-yellow-50/50">{formatMoney(stats.plannedClientPrice)}</td>
            <td className="px-3 py-2 text-right">
                {!isEditing ? (
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                        {item.item && (
                            <>
                                <button
                                    onClick={async () => {
                                        await onSyncFromAccounting({ itemId: item.item!._id, sectionId: section._id });
                                    }}
                                    className="text-[11px] text-blue-700 hover:underline"
                                    title="Sync item from accounting"
                                >
                                    Sync from accounting
                                </button>
                                <button
                                    onClick={async () => {
                                        await onSyncToItem({ itemId: item.item!._id });
                                    }}
                                    className="text-[11px] text-blue-700 hover:underline"
                                    title="Sync accounting from item"
                                >
                                    Sync to accounting
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => setIsEditing(true)}
                            className="p-1 rounded hover:bg-gray-200"
                            title="Edit section"
                        >
                            <Pencil className="w-4 h-4 text-gray-700" />
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="p-1 rounded hover:bg-red-100 disabled:opacity-50"
                            title="Delete section"
                        >
                            <Trash2 className="w-4 h-4 text-red-700" />
                        </button>
                    </div>
                ) : (
                    <div className="flex justify-end gap-1">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="p-1 rounded hover:bg-green-100 disabled:opacity-50"
                            title="Save"
                        >
                            <Save className="w-4 h-4 text-green-700" />
                        </button>
                        <button
                            onClick={() => setIsEditing(false)}
                            disabled={isSaving}
                            className="p-1 rounded hover:bg-gray-200 disabled:opacity-50"
                            title="Cancel"
                        >
                            <X className="w-4 h-4 text-gray-700" />
                        </button>
                    </div>
                )}
            </td>
        </tr>
    );
}
