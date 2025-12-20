"use client";

import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

type MigrationResult = Record<string, unknown>;

export default function AdminItemsPage() {
    const projects = useQuery(api.projects.listProjects, {});
    const backfillFromAccounting = useAction(api.itemsMigrations.backfillFromAccounting);
    const linkTasksToItems = useAction(api.itemsMigrations.linkTasksToItems);
    const proposeFromConceptCards = useAction(api.itemsMigrations.proposeFromConceptCards);

    const [selectedProjectId, setSelectedProjectId] = useState<string>("");
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<MigrationResult[] | null>(null);

    const runMigration = async (action: "backfill" | "linkTasks" | "proposeConcepts") => {
        setIsRunning(true);
        try {
            const projectId = selectedProjectId ? (selectedProjectId as Id<"projects">) : undefined;
            let output: MigrationResult[] = [];
            if (action === "backfill") {
                output = await backfillFromAccounting({ projectId });
            } else if (action === "linkTasks") {
                output = await linkTasksToItems({ projectId });
            } else {
                output = await proposeFromConceptCards({ projectId });
            }
            setResults(output);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white border rounded-lg p-4 space-y-3">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Items migrations</h2>
                    <p className="text-sm text-gray-600 mt-1">
                        Run backfills and linking jobs after the items refactor. Choose a project or run across all projects.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        Project scope
                    </label>
                    <select
                        className="border rounded px-3 py-2 text-sm bg-white"
                        value={selectedProjectId}
                        onChange={(e) => setSelectedProjectId(e.target.value)}
                    >
                        <option value="">All projects</option>
                        {(projects ?? []).map((project) => (
                            <option key={project._id} value={project._id}>
                                {project.name} ({project.clientName})
                            </option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="px-3 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        disabled={isRunning}
                        onClick={() => runMigration("backfill")}
                    >
                        {isRunning ? "Running..." : "Backfill from accounting"}
                    </button>
                    <button
                        type="button"
                        className="px-3 py-2 rounded text-sm bg-gray-900 text-white hover:bg-black disabled:opacity-50"
                        disabled={isRunning}
                        onClick={() => runMigration("linkTasks")}
                    >
                        {isRunning ? "Running..." : "Link tasks to items"}
                    </button>
                    <button
                        type="button"
                        className="px-3 py-2 rounded text-sm bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                        disabled={isRunning}
                        onClick={() => runMigration("proposeConcepts")}
                    >
                        {isRunning ? "Running..." : "Propose from concept cards"}
                    </button>
                </div>
            </div>

            <div className="bg-white border rounded-lg p-4 space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Latest results</h3>
                {results === null ? (
                    <div className="text-sm text-gray-500">No migration run yet.</div>
                ) : results.length === 0 ? (
                    <div className="text-sm text-gray-500">No results returned.</div>
                ) : (
                    <pre className="text-xs bg-gray-50 border rounded p-3 overflow-auto">
{JSON.stringify(results, null, 2)}
                    </pre>
                )}
            </div>
        </div>
    );
}
