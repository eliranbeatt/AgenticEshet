"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";

export function FactsPanel({ projectId }: { projectId: Id<"projects"> }) {
  const facts = useQuery(api.facts.listFacts, { projectId });
  const acceptFact = useMutation(api.facts.acceptFact);
  const rejectFact = useMutation(api.facts.rejectFact);
  const resolveConflict = useMutation(api.facts.resolveConflict);

  const [filter, setFilter] = useState<"all" | "needsReview" | "conflict">("all");

  if (!facts) return <div className="text-xs text-gray-500">Loading facts...</div>;

  const needsReview = facts.filter((f) => f.needsReview || f.status === "proposed");
  const conflicts = facts.filter((f) => f.status === "conflict");
  const accepted = facts.filter((f) => f.status === "accepted");

  const displayedFacts =
    filter === "needsReview"
      ? needsReview
      : filter === "conflict"
      ? conflicts
      : facts;

  return (
    <div className="flex flex-col h-full bg-white border-l">
      <div className="p-3 border-b flex items-center justify-between bg-gray-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Facts Ledger</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setFilter("all")}
            className={`px-2 py-0.5 text-[10px] rounded ${filter === "all" ? "bg-blue-100 text-blue-700" : "text-gray-500"}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("needsReview")}
            className={`px-2 py-0.5 text-[10px] rounded ${filter === "needsReview" ? "bg-yellow-100 text-yellow-700" : "text-gray-500"}`}
          >
            Review ({needsReview.length})
          </button>
          <button
            onClick={() => setFilter("conflict")}
            className={`px-2 py-0.5 text-[10px] rounded ${filter === "conflict" ? "bg-red-100 text-red-700" : "text-gray-500"}`}
          >
            Conflict ({conflicts.length})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {displayedFacts.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-4">No facts found.</div>
        )}
        {displayedFacts.map((fact) => (
          <div
            key={fact._id}
            className={`p-2 rounded border text-xs ${
              fact.status === "conflict"
                ? "border-red-200 bg-red-50"
                : fact.needsReview
                ? "border-yellow-200 bg-yellow-50"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex justify-between items-start mb-1">
              <span className="font-mono text-gray-600 truncate max-w-[150px]" title={fact.key}>
                {fact.key}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                  fact.status === "accepted"
                    ? "bg-green-100 text-green-700"
                    : fact.status === "rejected"
                    ? "bg-gray-100 text-gray-500"
                    : fact.status === "conflict"
                    ? "bg-red-100 text-red-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {fact.status}
              </span>
            </div>

            <div className="font-medium text-gray-900 mb-1">
              {typeof fact.value === "object" ? JSON.stringify(fact.value) : String(fact.value)}
            </div>

            {fact.evidence && (
              <div className="text-gray-500 italic mb-2 border-l-2 border-gray-300 pl-2 text-[10px]">
                "{fact.evidence.quote}"
              </div>
            )}

            <div className="flex justify-end gap-2 mt-2">
              {(fact.status === "proposed" || fact.needsReview) && (
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
              {fact.status === "conflict" && (
                <button
                  onClick={() =>
                    resolveConflict({
                      projectId,
                      scopeType: fact.scopeType as "project" | "item",
                      itemId: fact.itemId || undefined,
                      key: fact.key,
                      chosenFactId: fact._id,
                    })
                  }
                  className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Resolve (Choose This)
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
