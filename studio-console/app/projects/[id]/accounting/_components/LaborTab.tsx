"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Plus, Wand2 } from "lucide-react";

export default function LaborTab({ data, projectId }: { data: any, projectId: Id<"projects"> }) {
  const addWorkLine = useMutation(api.accounting.addWorkLine);
  const updateWorkLine = useMutation(api.accounting.updateWorkLine);
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
    await addWorkLine({
      projectId,
      sectionId,
      workType: "studio",
      role: "General Labor",
      rateType: "day",
      plannedQuantity: 1,
      plannedUnitCost: 0,
      status: "planned"
    });
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
                {data.sections.map((s: any) => (
                    <option key={s.section._id} value={s.section._id}>{s.section.name}</option>
                ))}
            </select>
        </div>
      </div>

      <div className="space-y-6">
        {filteredSections.map((item: any) => {
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
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {work.map((w: any) => (
                                        <WorkRow 
                                            key={w._id} 
                                            line={w} 
                                            update={updateWorkLine} 
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

function WorkRow({ line, update }: { line: any, update: any }) {
    const plannedTotal = line.rateType === "flat" ? line.plannedUnitCost : (line.plannedQuantity * line.plannedUnitCost);
    
    // Actuals logic
    const actQty = line.actualQuantity ?? line.plannedQuantity;
    const actRate = line.actualUnitCost ?? line.plannedUnitCost;
    const actualTotal = line.rateType === "flat" ? actRate : (actQty * actRate);

    const gap = actualTotal - plannedTotal;
    const isOverBudget = gap > 0;

    return (
        <tr className="hover:bg-gray-50">
            <td className="px-3 py-2">
                <input 
                    className="w-full bg-transparent border-none focus:ring-1 rounded px-1 font-medium" 
                    defaultValue={line.role}
                    onBlur={(e) => update({ id: line._id, updates: { role: e.target.value } })}
                />
                <input 
                    className="w-full bg-transparent border-none focus:ring-1 rounded px-1 text-xs text-gray-500" 
                    defaultValue={line.description || ""}
                    placeholder="Description..."
                    onBlur={(e) => update({ id: line._id, updates: { description: e.target.value } })}
                />
            </td>
             <td className="px-3 py-2">
                 <select 
                    className="bg-transparent border-none focus:ring-1 rounded px-1 text-xs"
                    value={line.rateType}
                    onChange={(e) => update({ id: line._id, updates: { rateType: e.target.value } })}
                 >
                    <option value="day">Day</option>
                    <option value="hour">Hour</option>
                    <option value="flat">Flat</option>
                 </select>
            </td>
            
            {/* Planned */}
            <td className="px-3 py-2 text-right bg-blue-50/30">
                {line.rateType !== "flat" && (
                    <input 
                        type="number"
                        className="w-16 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                        defaultValue={line.plannedQuantity}
                        onBlur={(e) => update({ id: line._id, updates: { plannedQuantity: parseFloat(e.target.value) } })}
                    />
                )}
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
                {line.rateType !== "flat" && (
                     <input 
                        type="number"
                        className="w-16 text-right bg-transparent border-none focus:ring-1 rounded px-1" 
                        placeholder={line.plannedQuantity.toString()}
                        defaultValue={line.actualQuantity}
                        onBlur={(e) => update({ id: line._id, updates: { actualQuantity: e.target.value ? parseFloat(e.target.value) : undefined } })}
                    />
                )}
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
        </tr>
    );
}
