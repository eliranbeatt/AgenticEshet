"use client";

import { useMemo, useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Loader2, Search, ShoppingCart, Check, Save, X } from "lucide-react";

interface BuyingAssistantPanelProps {
    materialLineId: Id<"materialLines">;
    label: string;
}

type SuggestionOption = {
    vendorName: string;
    vendorUrl?: string;
    priceMin?: number;
    priceMax?: number;
    unit: string;
    leadTimeDays?: number;
    notes?: string;
    confidence: string;
};

type SuggestionCitation = {
    title: string;
    url: string;
    snippet?: string;
};

type SuggestionsResponse = {
    summary: string;
    source: string;
    options: SuggestionOption[];
    citations?: SuggestionCitation[];
};

export function BuyingAssistantPanel({ materialLineId, label }: BuyingAssistantPanelProps) {
    const suggestions = useQuery(api.buying.getSuggestions, { materialLineId }) as
        | SuggestionsResponse
        | null
        | undefined;
    const materialLine = useQuery(api.buying.getMaterialLineContext, { materialLineId });
    const generateSuggestions = useAction(api.buying.generateSuggestions);
    const startResearch = useAction(api.research.startOnlineResearch);
    const cancelResearch = useAction(api.research.cancelOnlineResearch);
    const addObservation = useMutation(api.prices.addManualObservation);
    
    const [isLoading, setIsLoading] = useState(false);
    const [isResearching, setIsResearching] = useState(false);
    const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set());
    const [researchRunId, setResearchRunId] = useState<Id<"researchRuns"> | null>(null);

    const researchRun = useQuery(
        api.research.getRun,
        researchRunId ? { researchRunId } : "skip"
    );

    const researchStatus = useMemo(() => researchRun?.status, [researchRun]);
    const procurement = useMemo(() => materialLine?.procurement ?? "either", [materialLine]);

    const procurementLabel = useMemo(() => {
        if (procurement === "in_stock") return "In stock";
        if (procurement === "local") return "Buy locally (Israel)";
        if (procurement === "abroad") return "Order abroad";
        return "Local or abroad";
    }, [procurement]);

    const handleGenerate = async () => {
        setIsLoading(true);
        try {
            await generateSuggestions({ materialLineId });
        } catch (error) {
            console.error("Failed to generate suggestions:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResearch = async () => {
        setIsResearching(true);
        try {
            if (procurement === "in_stock") return;
            const result = await startResearch({ materialLineId, query: label });
            setResearchRunId(result.researchRunId);
        } catch (error) {
            console.error("Failed to research online:", error);
        } finally {
            setIsResearching(false);
        }
    };

    const handleCancelResearch = async () => {
        if (!researchRunId) return;
        try {
            await cancelResearch({ researchRunId });
        } catch (error) {
            console.error("Failed to cancel research:", error);
        }
    };

    const handleSaveObservation = async (opt: SuggestionOption, idx: number) => {
        try {
            const price =
                typeof opt.priceMin === "number" && typeof opt.priceMax === "number"
                    ? (opt.priceMin + opt.priceMax) / 2
                    : typeof opt.priceMin === "number"
                        ? opt.priceMin
                        : typeof opt.priceMax === "number"
                            ? opt.priceMax
                            : null;

            if (price == null) return;

            await addObservation({
                rawItemName: label,
                unit: opt.unit,
                unitPrice: price,
                currency: "ILS", // Defaulting to ILS for now
                notes: `Saved from Buying Assistant. Vendor: ${opt.vendorName}. ${opt.notes || ""}`,
            });
            setSavedIndices(prev => new Set(prev).add(idx));
        } catch (error) {
            console.error("Failed to save observation:", error);
        }
    };

    if (suggestions === undefined) return null; // Loading initial query

    return (
        <div className="mt-2 border-t pt-2">
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold flex items-center text-blue-700">
                    <ShoppingCart className="w-4 h-4 mr-1" />
                    Buying Assistant
                </h4>
                <div className="flex space-x-2">
                    {!suggestions && (
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                            Check History
                        </button>
                    )}
                    <button
                        type="button"
                        className="h-7 rounded px-2 text-xs text-blue-600 hover:bg-blue-50 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={handleResearch}
                        disabled={
                            procurement === "in_stock" ||
                            isResearching ||
                            researchStatus === "queued" ||
                            researchStatus === "running"
                        }
                    >
                        {isResearching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Search className="w-3 h-3 mr-1" />}
                        Search Online
                    </button>
                </div>
            </div>

            <div className="mb-2 text-[11px] text-gray-600">
                Procurement: <span className="font-medium text-gray-700">{procurementLabel}</span>
                {procurement === "in_stock" ? (
                    <span className="text-gray-500"> - Online research disabled; use history for price estimate.</span>
                ) : null}
            </div>

            {researchRun && (researchRun.status === "queued" || researchRun.status === "running") && (
                <div className="mb-2 flex items-center justify-between rounded border bg-white px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 text-gray-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Research {researchRun.status}…</span>
                    </div>
                    <button
                        type="button"
                        className="h-6 rounded px-2 text-xs text-gray-500 hover:bg-gray-50"
                        onClick={handleCancelResearch}
                        title="Cancel research"
                    >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                    </button>
                </div>
            )}

            {researchRun && researchRun.status === "failed" && (
                <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    Research failed: {researchRun.error || "Unknown error"}
                </div>
            )}

            {suggestions && (
                <div className="bg-blue-50 p-3 rounded-md text-sm">
                    <div className="flex justify-between items-start mb-2">
                        <p className="text-gray-700 text-xs">{suggestions.summary}</p>
                        <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-600 border border-gray-200">
                            {suggestions.source}
                        </span>
                    </div>

                    {suggestions.options.length > 0 ? (
                        <div className="space-y-2">
                            {suggestions.options.map((opt: SuggestionOption, idx: number) => (
                                <div key={idx} className="flex justify-between items-center bg-white p-2 rounded border">
                                    <div>
                                        <div className="font-medium text-blue-900">{opt.vendorName}</div>
                                        <div className="text-xs text-gray-500">{opt.notes}</div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="text-right">
                                            <div className="font-bold">
                                                {opt.priceMin?.toFixed(2)} - {opt.priceMax?.toFixed(2)}
                                            </div>
                                            <div className="text-xs text-gray-500">{opt.unit}</div>
                                        </div>
                                        <button
                                            type="button"
                                            className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-green-600 disabled:cursor-not-allowed disabled:opacity-60"
                                            title="Save as Observation"
                                            onClick={() => handleSaveObservation(opt, idx)}
                                            disabled={savedIndices.has(idx)}
                                        >
                                            {savedIndices.has(idx) ? <Check className="w-4 h-4 text-green-600" /> : <Save className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-gray-500 italic">No historical data found.</div>
                    )}

                    {suggestions.citations && suggestions.citations.length > 0 && (
                        <div className="mt-3">
                            <div className="text-xs font-medium text-gray-700 mb-1">Citations</div>
                            <ul className="space-y-1">
                                {suggestions.citations.slice(0, 6).map((c, i) => (
                                    <li key={i} className="text-xs text-gray-600">
                                        <a className="text-blue-700 hover:underline" href={c.url} target="_blank" rel="noreferrer">
                                            {c.title}
                                        </a>
                                        {c.snippet ? <span className="text-gray-500"> — {c.snippet}</span> : null}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    
                    <div className="mt-2 text-right">
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="h-auto p-0 text-xs text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isLoading ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
