"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id, type Doc } from "../../../../convex/_generated/dataModel";

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
    const generateFromAccounting = useMutation(api.quotes.generateFromAccounting);
    
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingFromAccounting, setIsGeneratingFromAccounting] = useState(false);
    const [instruction, setInstruction] = useState("");
    const [selectedQuoteId, setSelectedQuoteId] = useState<Id<"quotes"> | null>(null);
    
    const selectedQuote = useMemo<Doc<"quotes"> | null>(() => {
        if (!quotes || quotes.length === 0) return null;
        if (!selectedQuoteId) return quotes[0];
        return quotes.find((quote: Doc<"quotes">) => quote._id === selectedQuoteId) ?? quotes[0];
    }, [quotes, selectedQuoteId]);

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

    const handleGenerateFromAccounting = async () => {
        setIsGeneratingFromAccounting(true);
        try {
            await generateFromAccounting({ projectId });
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Unknown error";
            alert(message);
        } finally {
            setIsGeneratingFromAccounting(false);
        }
    };

    const breakdown = useMemo<QuoteBreakdownItem[]>(() => {
        if (!selectedQuote) {
            return [];
        }

        try {
            const parsed = JSON.parse(selectedQuote.internalBreakdownJson);
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed.map((item) => ({
                label: String(item.label),
                amount: Number(item.amount) || 0,
                currency: item.currency ? String(item.currency) : selectedQuote.currency || "ILS",
                notes: item.notes ? String(item.notes) : undefined,
            }));
        } catch {
            return [];
        }
    }, [selectedQuote]);

    const total = useMemo(() => {
        if (selectedQuote?.totalAmount) {
            return selectedQuote.totalAmount;
        }
        return breakdown.reduce((sum, item) => sum + item.amount, 0);
    }, [selectedQuote, breakdown]);

    const handleExport = async () => {
        if (!selectedQuote) return;
        try {
            const payload = [
                `Quote v${selectedQuote.version}`,
                `Total: ${total.toLocaleString()} ${selectedQuote.currency || "ILS"}`,
                "",
                selectedQuote.clientDocumentText,
            ].join("\n");
            await navigator.clipboard.writeText(payload);
            alert("Quote copied to clipboard.");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to copy quote";
            alert(message);
        }
    };

    return (
        <div className="flex h-[calc(100vh-12rem)] gap-6">
            {/* Left: Controls & History */}
            <div className="w-1/3 flex flex-col space-y-4">
                <div className="bg-white p-4 rounded shadow-sm border">
                    <h2 className="text-lg font-bold mb-4">Quotes</h2>
                    <p className="text-sm text-gray-600 mb-4">
                        Quotes are built from Accounting totals (cost + margins) and exported as a single line per item.
                    </p>

                    <button
                        onClick={handleGenerateFromAccounting}
                        disabled={isGeneratingFromAccounting}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 hover:bg-blue-700 mb-4"
                    >
                        {isGeneratingFromAccounting ? "Generating..." : "Generate from Accounting"}
                    </button>
                    
                    <div className="space-y-2">
                        <textarea
                            className="w-full border rounded p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows={3}
                            placeholder="Optional: ask the agent to generate a narrative or alternate structure..."
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                        />
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className="w-full bg-green-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 hover:bg-green-700"
                        >
                            {isGenerating ? "Generating..." : "Generate with Agent"}
                        </button>
                    </div>
                </div>

                <div className="bg-white p-4 rounded shadow-sm border flex-1 overflow-hidden flex flex-col">
                    <h3 className="font-bold text-sm mb-2">History</h3>
                    <div className="flex-1 overflow-y-auto space-y-2">
                        {quotes?.map((q: Doc<"quotes">) => (
                            <button
                                key={q._id}
                                onClick={() => setSelectedQuoteId(q._id)}
                                className={`w-full p-2 border rounded text-sm text-left transition ${
                                    selectedQuote?._id === q._id ? "border-green-500 bg-green-50" : "hover:bg-gray-50"
                                }`}
                            >
                                <div className="flex justify-between font-medium">
                                    <span>Version {q.version}</span>
                                    <span className="text-gray-500">{new Date(q.createdAt).toLocaleDateString()}</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Total: {(q.totalAmount || 0).toLocaleString()} {q.currency || "ILS"}
                                </div>
                            </button>
                        ))}
                        {(!quotes || quotes.length === 0) && <div className="text-gray-400 text-sm italic">No quotes generated yet.</div>}
                    </div>
                </div>
            </div>

            {/* Right: Quote Preview */}
            <div className="flex-1 bg-white rounded shadow-sm border flex flex-col overflow-hidden">
                {!selectedQuote ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        No quote available. Generate one to start.
                    </div>
                ) : (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-4 justify-between items-center">
                            <div>
                                <h2 className="font-bold text-gray-800">Quote Breakdown (v{selectedQuote.version})</h2>
                                <p className="text-xs text-gray-500">Generated {new Date(selectedQuote.createdAt).toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="text-xl font-bold text-green-700">
                                    Total: {total.toLocaleString()} {selectedQuote.currency || "ILS"}
                                </div>
                                <button
                                    onClick={handleExport}
                                    className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100"
                                >
                                    Export
                                </button>
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
                                            <td className="p-2 border text-right">{total.toLocaleString()} {selectedQuote.currency || "ILS"}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            {/* Client Doc */}
                            <div>
                                <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Client Document Preview</h3>
                                <div className="p-6 bg-white border shadow-sm rounded-lg prose prose-sm max-w-none font-serif text-gray-800 whitespace-pre-wrap">
                                    {selectedQuote.clientDocumentText}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
