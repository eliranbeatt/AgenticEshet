"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";

export function TrelloPanel({ projectId }: { projectId: Id<"projects"> }) {
    const plan = useQuery(api.trello.getLatestPlan, { projectId }); // Need to implement
    const syncAction = useAction(api.trello.executeSync); // Need to implement
    const [syncing, setSyncing] = useState(false);

    const handleSync = async () => {
        setSyncing(true);
        try {
            await syncAction({ projectId });
        } catch (e) {
            console.error("Sync failed", e);
            alert("Sync failed");
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center p-4 border-b">
                <h3 className="font-bold text-sm text-gray-700">Trello Sync</h3>
                <button 
                    onClick={handleSync}
                    disabled={syncing}
                    className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                >
                    {syncing ? "Syncing..." : "Sync Now"}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {plan ? (
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-3 rounded text-xs border border-blue-100">
                            <div className="font-semibold text-blue-800">Latest Plan</div>
                            <div className="text-blue-600 mt-1">
                                Status: {plan.status}
                            </div>
                            <div className="text-blue-600">
                                Operations: {JSON.parse(plan.operationsJson || "[]").length}
                            </div>
                        </div>
                        
                        <div className="space-y-2">
                            {JSON.parse(plan.operationsJson || "[]").map((op: any, i: number) => (
                                <div key={i} className="text-xs p-2 border rounded bg-white">
                                    <span className="font-bold uppercase text-gray-500 mr-2">{op.op}</span>
                                    <span>{op.title}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="text-gray-400 text-xs text-center py-8">
                        No sync plan generated yet.
                        <br/>
                        Run the "Trello" skill to generate one.
                    </div>
                )}
            </div>
        </div>
    );
}
