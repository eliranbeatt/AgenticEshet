"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMemo, useState } from "react";

export function FactsPanel({ projectId }: { projectId: Id<"projects"> }) {
  const facts = useQuery(api.factsV2.listFacts, { projectId });
  const issues = useQuery(api.factsV2.listIssues, { projectId });
  const runs = useQuery(api.factsV2.listExtractionRuns, { projectId, limit: 1 });
  const itemsTree = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
  const acceptFact = useMutation(api.factsV2.acceptFact);
  const rejectFact = useMutation(api.factsV2.rejectFact);
  const resolveIssue = useMutation(api.factsV2.resolveIssue);
  const assignItem = useMutation(api.factsV2.assignItem);

  const [tab, setTab] = useState<"facts" | "inbox">("facts");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "accepted" | "proposed" | "hypothesis" | "rejected" | "duplicate"
  >("all");

  const items = useMemo(() => itemsTree?.items ?? [], [itemsTree]);

  if (!facts || !issues || !runs) return <div className="text-xs text-gray-500">Loading facts...</div>;

  const displayedFacts = facts.filter((fact) => {
    if (statusFilter === "all") return true;
    return fact.status === statusFilter;
  });

  const inboxFacts = facts.filter((fact) => fact.status === "proposed" || fact.status === "hypothesis");
  const latestRun = runs[0];
  const latestRunLabel = latestRun
    ? `${latestRun.status} • ${new Date(latestRun.createdAt).toLocaleString()}`
    : "no runs yet";

  return (
    <div className="flex flex-col h-full bg-white border-l">
      <div className="p-3 border-b flex items-center justify-between bg-gray-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Facts Ledger</h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => setTab("facts")}
              className={`px-2 py-0.5 text-[10px] rounded ${tab === "facts" ? "bg-blue-100 text-blue-700" : "text-gray-500"}`}
            >
              Facts
            </button>
            <button
              onClick={() => setTab("inbox")}
              className={`px-2 py-0.5 text-[10px] rounded ${tab === "inbox" ? "bg-yellow-100 text-yellow-700" : "text-gray-500"}`}
            >
              Inbox ({issues.length})
            </button>
          </div>
        </div>
      </div>
      <div className="px-3 py-2 border-b text-[10px] text-gray-500">
        Extraction: {latestRunLabel}
        {latestRun?.status === "failed" && latestRun.error?.message ? ` • ${latestRun.error.message}` : ""}
      </div>

      {tab === "facts" ? (
        <>
          <div className="p-2 border-b flex items-center gap-2 text-[10px] text-gray-600">
            <span>Status:</span>
            {(["all", "accepted", "proposed", "hypothesis", "rejected", "duplicate"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-2 py-0.5 rounded ${
                  statusFilter === status ? "bg-blue-100 text-blue-700" : "text-gray-500"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {displayedFacts.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-4">No facts found.</div>
            )}
            {displayedFacts.map((fact) => (
              <div key={fact._id} className="p-2 rounded border text-xs border-gray-200 bg-white">
                <div className="flex justify-between items-start mb-1">
                  <span className="font-semibold text-gray-900">{fact.factTextHe}</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] uppercase bg-gray-100 text-gray-600">
                    {fact.status}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500 mb-2">
                  Tier: {fact.sourceTier} | Confidence: {fact.confidence.toFixed(2)} | Importance: {fact.importance}
                </div>
                {fact.evidence && fact.evidence.length > 0 && (
                  <div className="text-gray-500 italic mb-2 border-l-2 border-gray-300 pl-2 text-[10px]">
                    &quot;{fact.evidence[0].quoteHe}&quot;
                  </div>
                )}
                <div className="flex justify-end gap-2 mt-2">
                  {(fact.status === "proposed" || fact.status === "hypothesis") && (
                    <>
                      <button
                        onClick={() => acceptFact({ factId: fact._id })}
                        className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => rejectFact({ factId: fact._id })}
                        className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {inboxFacts.length === 0 && issues.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-4">Inbox is clear.</div>
          )}
          {inboxFacts.map((fact) => (
            <div key={fact._id} className="p-2 rounded border text-xs border-yellow-200 bg-yellow-50">
              <div className="font-semibold text-gray-900 mb-1">{fact.factTextHe}</div>
              <div className="text-[10px] text-gray-500 mb-2">Status: {fact.status}</div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => acceptFact({ factId: fact._id })}
                  className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Accept
                </button>
                <button
                  onClick={() => rejectFact({ factId: fact._id })}
                  className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
          {issues.map((issue) => (
            <div key={issue._id} className="p-2 rounded border text-xs border-red-200 bg-red-50">
              <div className="font-semibold text-gray-900 mb-1">{issue.type}</div>
              <div className="text-[10px] text-gray-600 mb-2">{issue.explanationHe ?? "Needs review."}</div>
              {issue.type === "missing_item_link" && (
                <div className="flex items-center gap-2 mb-2">
                  <select
                    className="border rounded text-[10px] p-1"
                    onChange={(event) => {
                      const itemId = event.target.value as Id<"projectItems">;
                      if (itemId) {
                        assignItem({ factId: issue.factId, itemId });
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Assign item...
                    </option>
                    {items.map((item) => (
                      <option key={item._id} value={item._id}>
                        {item.title ?? item.name ?? "Untitled item"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => resolveIssue({ issueId: issue._id, resolution: "resolved" })}
                  className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Resolve
                </button>
                <button
                  onClick={() => resolveIssue({ issueId: issue._id, resolution: "dismissed" })}
                  className="px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
