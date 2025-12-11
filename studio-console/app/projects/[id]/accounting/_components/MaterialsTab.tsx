"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Save, Plus, Wand2 } from "lucide-react";

export default function MaterialsTab({ data, projectId }: { data: any, projectId: Id<"projects"> }) {
  const addMaterialLine = useMutation(api.accounting.addMaterialLine);
  const updateMaterialLine = useMutation(api.accounting.updateMaterialLine);
  const saveToCatalog = useMutation(api.accounting.saveToCatalog);
  const estimateSection = useAction(api.agents.estimator.run);

  const [filterSection, setFilterSection] = useState<string>("all");
  const [estimatingIds, setEstimatingIds] = useState<Set<string>>(new Set());

  const handleEstimate = async (sectionId: string) => {
    if (!confirm("This will generate new material and labor lines using AI. Continue?")) return;
    setEstimatingIds(prev => new Set(prev).add(sectionId));
    try {
        await estimateSection({ projectId, sectionId: sectionId as Id<"sections"> });
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
    : data.sections.filter((s: any) => s.section._id === filterSection);

  const handleAddLine = async (sectionId: Id<"sections">) => {
    await addMaterialLine({
      projectId,
      sectionId,
      category: "General",
      label: "New Material",
      unit: "unit",
      plannedQuantity: 1,
      plannedUnitCost: 0,
      status: "planned"
    });
  };

  const handleSaveToCatalog = async (line: any) => {
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
                {data.sections.map((s: any) => (
                    <option key={s.section._id} value={s.section._id}>{s.section.name}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="space-y-6">
        {filteredSections.map((item: any) => {
            const { section, materials } = item;
            return (
                <div key={section._id} className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                        <h3 className="font-medium text-gray-700">{section.name}</h3>
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
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Qty</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-blue-50">Plan Cost</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Qty</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase bg-green-50">Act Cost</th>
                                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gap</th>
                                        <th className="px-3 py-2 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {materials.map((m: any) => (
                                        <MaterialRow 
                                            key={m._id} 
                                            line={m} 
                                            update={updateMaterialLine} 
                                            onSaveCatalog={() => handleSaveToCatalog(m)}
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

function MaterialRow({ line, update, onSaveCatalog }: { line: any, update: any, onSaveCatalog: () => void }) {
    const plannedTotal = line.plannedQuantity * line.plannedUnitCost;
    const actualTotal = (line.actualQuantity ?? line.plannedQuantity) * (line.actualUnitCost ?? line.plannedUnitCost);
    const gap = actualTotal - plannedTotal;
    const isOverBudget = gap > 0;

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                <input 
                    className="w-full bg-transparent border-none focus:ring-1 rounded px-1" 
                    defaultValue={line.label}
                    onBlur={(e) => update({ id: line._id, updates: { label: e.target.value } })}
                />
                <div className="text-xs text-gray-400">{line.category}</div>
            </td>
            <td className="px-3 py-2">
                 <input 
                    className="w-full bg-transparent border-none focus:ring-1 rounded px-1" 
                    defaultValue={line.vendorName}
                    placeholder="Vendor..."
                    onBlur={(e) => update({ id: line._id, updates: { vendorName: e.target.value } })}
                />
            </td>
            
            {/* Planned */}
            <td className="px-3 py-2 text-right bg-blue-50/30">
                <input 
                    type="number"
                    className="w-16 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                    defaultValue={line.plannedQuantity}
                    onBlur={(e) => update({ id: line._id, updates: { plannedQuantity: parseFloat(e.target.value) } })}
                />
            </td>
            <td className="px-3 py-2 text-right bg-blue-50/30">
                <input 
                    type="number"
                    className="w-20 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                    defaultValue={line.plannedUnitCost}
                    onBlur={(e) => update({ id: line._id, updates: { plannedUnitCost: parseFloat(e.target.value) } })}
                />
            </td>

            {/* Actual */}
            <td className="px-3 py-2 text-right bg-green-50/30">
                 <input 
                    type="number"
                    className="w-16 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                    placeholder={line.plannedQuantity.toString()}
                    defaultValue={line.actualQuantity}
                    onBlur={(e) => update({ id: line._id, updates: { actualQuantity: e.target.value ? parseFloat(e.target.value) : undefined } })}
                />
            </td>
            <td className="px-3 py-2 text-right bg-green-50/30">
                <input 
                    type="number"
                    className="w-20 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                    placeholder={line.plannedUnitCost.toString()}
                    defaultValue={line.actualUnitCost}
                    onBlur={(e) => update({ id: line._id, updates: { actualUnitCost: e.target.value ? parseFloat(e.target.value) : undefined } })}
                />
            </td>

            <td className={`px-3 py-2 text-right font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
                {gap.toFixed(2)}
            </td>
            <td className="px-3 py-2">
                <button 
                    onClick={onSaveCatalog}
                    className="text-gray-400 hover:text-blue-600"
                    title="Save to Catalog"
                >
                    <Save className="w-4 h-4" />
                </button>
            </td>
        </tr>
    );
}
