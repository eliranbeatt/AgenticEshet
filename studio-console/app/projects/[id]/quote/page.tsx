"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type QuoteBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes?: string;
};

export default function QuotePage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const quotes = useQuery(api.agents.quote.listQuotes, { projectId });
    const runQuoteAgent = useAction(api.agents.quote.run);
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [instruction, setInstruction] = useState("");
    
    // Display latest quote by default
    const latestQuote = quotes?.[0];

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            await runQuoteAgent({ projectId, instructions: instruction });
            setInstruction("");
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Failed to generate quote: " + message);
        } finally {
            setIsGenerating(false);
        }
    };

    const breakdown = useMemo<QuoteBreakdownItem[]>(() => {
        if (!latestQuote) {
            return [];
        }

        try {
            const parsed = JSON.parse(latestQuote.internalBreakdownJson);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.map((item) => ({
                label: String(item.label),
                amount: Number(item.amount) || 0,
                currency: item.currency ? String(item.currency) : latestQuote.currency || "ILS",
                notes: item.notes ? String(item.notes) : undefined,
            }));
        } catch {
            return [];
        }
    }, [latestQuote]);

    const total = useMemo(() => {
        if (latestQuote?.totalAmount) {
            return latestQuote.totalAmount;
        }
        return breakdown.reduce((sum, item) => sum + item.amount, 0);
    }, [latestQuote, breakdown]);

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
            {/* Left: Controls & History */}
            <div className="w-1/3 flex flex-col space-y-4">
                <div className="bg-white p-4 rounded shadow-sm border">
                    <h2 className="text-lg font-bold mb-4">Quote Agent</h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Generate a cost estimate based on project tasks and details.
                    </p>
                    
                    <div className="space-y-2">
                        <textarea
                            className="w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={3}
                            placeholder="E.g., 'Add 10% contingency' or 'Include travel costs'..."
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="w-full bg-green-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 hover:bg-green-700"
                        >
                            {isGenerating ? "Calculating..." : "Generate Quote"}
                        </button>
                    </div>
                </div>

                <div className="bg-white p-4 rounded shadow-sm border flex-1 overflow-hidden flex flex-col">
                    <h3 className="font-bold text-sm mb-2">History</h3>
                    <div className="flex-1 overflow-y-auto space-y-2">
                        {quotes?.map((q) => (
                            <div key={q._id} className="p-2 border rounded text-sm hover:bg-gray-50 cursor-pointer">
                                <div className="flex justify-between font-medium">
                                    <span>Version {q.version}</span>
                                    <span className="text-gray-500">{new Date(q.createdAt).toLocaleDateString()}</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Total: {q.totalAmount?.toLocaleString() || "N/A"} {q.currency || "ILS"}
                                </div>
                            </div>
                        ))}
                        {(!quotes || quotes.length === 0) && <div className="text-gray-400 text-sm italic">No quotes generated yet.</div>}
                    </div>
                </div>
            </div>

            {/* Right: Quote Preview */}
            <div className="flex-1 bg-white rounded shadow-sm border flex flex-col overflow-hidden">
                {!latestQuote ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        No quote available. Generate one to start.
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                            <h2 className="font-bold text-gray-800">Quote Breakdown (v{latestQuote.version})</h2>
                            <div className="text-xl font-bold text-green-700">
                                Total: {total.toLocaleString()} {latestQuote.currency || "ILS"}
                            </div>
                        </div>

                        {/* Content Scrollable */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {/* Breakdown Table */}
                            <div className="mb-8">
                                <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Cost Breakdown</h3>
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="bg-gray-100 text-gray-600">
                                        <tr>
                                            <th className="p-2 border">Item</th>
                                            <th className="p-2 border">Notes</th>
                                            <th className="p-2 border text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {breakdown.map((item, i: number) => (
                                            <tr key={i} className="border-b">
                                                <td className="p-2 border font-medium">{item.label}</td>
                                                <td className="p-2 border text-gray-500">{item.notes || "-"}</td>
                                                <td className="p-2 border text-right font-mono">
                                                    {item.amount.toLocaleString()} {item.currency}
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="bg-gray-50 font-bold">
                                            <td className="p-2 border" colSpan={2}>Total</td>
                                            <td className="p-2 border text-right">{total.toLocaleString()} {latestQuote.currency || "ILS"}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Client Doc */}
                            <div>
                                <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Client Document Preview</h3>
                                <div className="p-6 bg-white border shadow-sm rounded-lg prose prose-sm max-w-none font-serif text-gray-800 whitespace-pre-wrap">
                                    {latestQuote.clientDocumentText}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
