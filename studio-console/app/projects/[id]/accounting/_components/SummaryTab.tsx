"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Plus, Wand2 } from "lucide-react";

export default function SummaryTab({ data, projectId }: { data: any, projectId: Id<"projects"> }) {
  const addSection = useMutation(api.accounting.addSection);
  const estimateProject = useAction(api.agents.estimator.estimateProject);

  const [newSectionGroup, setNewSectionGroup] = useState("General");
  const [newSectionName, setNewSectionName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isEstimatingAll, setIsEstimatingAll] = useState(false);

  const handleEstimateAll = async () => {
    if (!confirm("This will auto-estimate ALL sections in Hebrew/ILS based on the plan. This may take a minute. Continue?")) return;
    setIsEstimatingAll(true);
    try {
        await estimateProject({ projectId });
        alert("Full project estimation complete!");
    } catch (e) {
        alert("Estimation failed: " + e);
    } finally {
        setIsEstimatingAll(false);
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

  // Grouping logic is already handled by backend sort, but we might want visual headers
  // Let's render a flat list with group headers for now or just a flat table with "Group" column.
  // The user asked for "Excel like", so a flat table is often better, but visual separation helps.

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: data.project.currency || 'ILS' }).format(amount);
  };

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Cost Summary</h2>
        <div className="flex space-x-2">
            <button 
                onClick={handleEstimateAll}
                disabled={isEstimatingAll}
                className="bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 flex items-center text-sm disabled:opacity-50"
            >
                <Wand2 className={`w-4 h-4 mr-1 ${isEstimatingAll ? 'animate-spin' : ''}`} /> 
                {isEstimatingAll ? "Estimating Project..." : "Auto-Estimate Project"}
            </button>
            <button 
                onClick={() => setIsAdding(!isAdding)}
                className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 flex items-center text-sm"
            >
                <Plus className="w-4 h-4 mr-1" /> Add Section
            </button>
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
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.sections.map((item: any) => {
               const { section, stats } = item;
               return (
                <tr key={section._id} className="hover:bg-gray-50 group">
                  <td className="px-3 py-2 text-gray-500">{section.group}</td>
                  <td className="px-3 py-2 font-medium">
                    {section.name}
                    {/* Add edit/delete actions on hover? */}
                  </td>
                  <td className="px-3 py-2 text-right bg-blue-50/50">{formatMoney(stats.plannedMaterialsCostE)}</td>
                  <td className="px-3 py-2 text-right bg-green-50/50">{formatMoney(stats.plannedWorkCostS)}</td>
                  <td className="px-3 py-2 text-right bg-gray-50 font-medium">{formatMoney(stats.plannedDirectCost)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedOverhead)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedRisk)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{formatMoney(stats.plannedProfit)}</td>
                  <td className="px-3 py-2 text-right font-bold bg-yellow-50/50">{formatMoney(stats.plannedClientPrice)}</td>
                </tr>
               );
            })}
            {/* Totals Row */}
            <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
              <td className="px-3 py-2" colSpan={2}>TOTALS</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((s:number, i:any) => s + i.stats.plannedMaterialsCostE, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((s:number, i:any) => s + i.stats.plannedWorkCostS, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.totals.plannedDirect)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((s:number, i:any) => s + i.stats.plannedOverhead, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((s:number, i:any) => s + i.stats.plannedRisk, 0))}</td>
              <td className="px-3 py-2 text-right">{formatMoney(data.sections.reduce((s:number, i:any) => s + i.stats.plannedProfit, 0))}</td>
              <td className="px-3 py-2 text-right bg-yellow-100">{formatMoney(data.totals.plannedClientPrice)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
