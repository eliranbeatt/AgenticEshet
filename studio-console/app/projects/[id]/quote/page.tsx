"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { QuotePreview } from "./_components/QuotePreview";
import { QuoteWizard } from "./_components/QuoteWizard";

export default function QuotePage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const quotes = useQuery(api.agents.quote.listQuotes, { projectId }) as Array<Doc<"quotes">> | undefined;
    const [selectedQuoteId, setSelectedQuoteId] = useState<Id<"quotes"> | null>(null);
    const [selectedElementId, setSelectedElementId] = useState<string>("all");
    const [includeManagement, setIncludeManagement] = useState(false);
    const [includeOptional, setIncludeOptional] = useState(false);

    const itemsData = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const elements = useMemo(() => (itemsData?.items ?? []) as Array<Doc<"projectItems">>, [itemsData?.items]);
    const elementSelection = selectedElementId === "all" ? null : (selectedElementId as Id<"projectItems">);

    const selectedQuote = useMemo(() => {
        if (!quotes || quotes.length === 0) return null;
        if (!selectedQuoteId) return quotes[0];
        return quotes.find((q) => q._id === selectedQuoteId) ?? quotes[0];
    }, [quotes, selectedQuoteId]);

    return (
        <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
            <div className="space-y-4">
                <div className="bg-white border rounded shadow-sm p-4 space-y-3">
                    <label className="flex items-center gap-2 text-sm">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Element</span>
                        <select
                            className="border rounded px-2 py-1 text-sm"
                            value={selectedElementId}
                            onChange={(event) => setSelectedElementId(event.target.value)}
                        >
                            <option value="all">All elements</option>
                            {elements.map((item) => (
                                <option key={item._id} value={item._id}>
                                    {item.title}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={includeManagement}
                                onChange={(event) => setIncludeManagement(event.target.checked)}
                            />
                            Include management costs
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={includeOptional}
                                onChange={(event) => setIncludeOptional(event.target.checked)}
                            />
                            Include optional lines
                        </label>
                    </div>
                </div>
                <QuoteWizard
                    projectId={projectId}
                    selectedElementId={elementSelection}
                    includeManagement={includeManagement}
                    includeOptional={includeOptional}
                    onCreated={(quoteId) => {
                        setSelectedQuoteId(quoteId);
                    }}
                />

                <div className="bg-white border rounded shadow-sm p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Versions</h3>
                        <div className="text-xs text-gray-500">{quotes ? `${quotes.length} total` : "..."}</div>
                    </div>
                    {quotes === undefined ? (
                        <div className="text-sm text-gray-500">Loading quotes...</div>
                    ) : quotes.length === 0 ? (
                        <div className="text-sm text-gray-500">No quotes yet. Create one from the wizard.</div>
                    ) : (
                        <div className="space-y-2">
                            {quotes.map((q) => (
                                <button
                                    key={q._id}
                                    type="button"
                                    className={`w-full text-left border rounded p-3 hover:bg-gray-50 ${
                                        (selectedQuoteId ?? quotes[0]._id) === q._id ? "bg-blue-50 border-blue-200" : ""
                                    }`}
                                    onClick={() => setSelectedQuoteId(q._id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="font-medium text-gray-900">Version {q.version}</div>
                                        <div className="text-xs text-gray-500">{new Date(q.createdAt).toLocaleDateString()}</div>
                                    </div>
                                    <div className="text-xs text-gray-600 mt-1">
                                        Total: {(q.totalAmount || 0).toLocaleString()} {q.currency || "ILS"}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {selectedQuote ? <QuotePreview quoteId={selectedQuote._id} /> : <div className="text-sm text-gray-500">No quote selected.</div>}
        </div>
    );
}
