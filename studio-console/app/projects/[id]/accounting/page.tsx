"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import SummaryTab from "./_components/SummaryTab";
import MaterialsTab from "./_components/MaterialsTab";
import LaborTab from "./_components/LaborTab";

export default function AccountingPage() {
  const params = useParams();
  const projectId = params.id as Id<"projects">;
  
  const [activeTab, setActiveTab] = useState<"summary" | "materials" | "labor">("summary");

  const accountingData = useQuery(api.accounting.getProjectAccounting, { projectId });

  if (!accountingData) {
    return <div className="p-8">Loading accounting data...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-4">
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
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-lg shadow p-4">
        {activeTab === "summary" && <SummaryTab data={accountingData} projectId={projectId} />}
        {activeTab === "materials" && <MaterialsTab data={accountingData} projectId={projectId} />}
        {activeTab === "labor" && <LaborTab data={accountingData} projectId={projectId} />}
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
