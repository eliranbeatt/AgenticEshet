"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import SummaryTab from "./_components/SummaryTab";
import MaterialsTab from "./_components/MaterialsTab";
import LaborTab from "./_components/LaborTab";
import DeepResearchTab from "./_components/DeepResearchTab";
import { ChangeSetReviewBanner } from "../_components/changesets/ChangeSetReviewBanner";

export default function AccountingPage() {
  const params = useParams();
  const projectId = params.id as Id<"projects">;
  
  const [activeTab, setActiveTab] = useState<"summary" | "materials" | "labor" | "deep-research">("summary");
  const [selectedElementId, setSelectedElementId] = useState<string>("all");
  const [includeManagement, setIncludeManagement] = useState(true);
  const [respectVisibility, setRespectVisibility] = useState(false);
  const [includeOptional, setIncludeOptional] = useState(true);

  const accountingData = useQuery(api.accounting.getProjectAccounting, { projectId });
  const itemsData = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
  const elements = useMemo(() => (itemsData?.items ?? []) as Array<Doc<"projectItems">>, [itemsData?.items]);
  const elementSelection = selectedElementId === "all"
    ? null
    : selectedElementId === "unlinked"
      ? "unlinked"
      : (selectedElementId as Id<"projectItems">);

  if (!accountingData) {
    return <div className="p-8">Loading accounting data...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <ChangeSetReviewBanner projectId={projectId} phase="accounting" />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Element</span>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={selectedElementId}
            onChange={(event) => setSelectedElementId(event.target.value)}
          >
            <option value="all">All elements</option>
            <option value="unlinked">Unlinked sections</option>
            {elements.map((item) => (
              <option key={item._id} value={item._id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={!includeManagement}
            onChange={(event) => setIncludeManagement(!event.target.checked)}
          />
          Exclude management costs
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={respectVisibility}
            onChange={(event) => setRespectVisibility(event.target.checked)}
          />
          Use quote visibility
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeOptional}
            onChange={(event) => setIncludeOptional(event.target.checked)}
            disabled={!respectVisibility}
          />
          Include optional lines
        </label>
      </div>
      <div className="flex space-x-2 border-b">
        <TabButton 
          label="Detailed Costs Planning (Summary)" 
          isActive={activeTab === "summary"} 
          onClick={() => setActiveTab("summary")} 
        />
        <TabButton 
          label="Materials Tracking" 
          isActive={activeTab === "materials"} 
          onClick={() => setActiveTab("materials")} 
        />
        <TabButton 
          label="Labor Tracking" 
          isActive={activeTab === "labor"} 
          onClick={() => setActiveTab("labor")} 
        />
        <TabButton
          label="Deep-Research"
          isActive={activeTab === "deep-research"}
          onClick={() => setActiveTab("deep-research")}
        />
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-lg shadow p-4">
        {activeTab === "summary" && (
          <SummaryTab
            data={accountingData}
            projectId={projectId}
            selectedElementId={elementSelection}
            includeManagement={includeManagement}
            includeOptional={includeOptional}
            respectVisibility={respectVisibility}
          />
        )}
        {activeTab === "materials" && (
          <MaterialsTab
            data={accountingData}
            projectId={projectId}
            selectedElementId={elementSelection}
            includeManagement={includeManagement}
            includeOptional={includeOptional}
            respectVisibility={respectVisibility}
          />
        )}
        {activeTab === "labor" && (
          <LaborTab
            data={accountingData}
            projectId={projectId}
            selectedElementId={elementSelection}
            includeManagement={includeManagement}
            includeOptional={includeOptional}
            respectVisibility={respectVisibility}
          />
        )}
        {activeTab === "deep-research" && <DeepResearchTab projectId={projectId} />}
      </div>
    </div>
  );
}

function TabButton({ label, isActive, onClick }: { label: string, isActive: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        isActive 
          ? "border-blue-600 text-blue-600" 
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
    >
      {label}
    </button>
  );
}
