"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { ImageGeneratorPanel } from "../../_components/images/ImageGeneratorPanel";
import { ImagePicker } from "../../_components/images/ImagePicker";

type QuoteBreakdownItem = {
    label: string;
    amount: number;
    currency: string;
    notes?: string;
};

export function QuotePreview({ quoteId }: { quoteId: Id<"quotes"> }) {
    const data = useQuery(api.quotes.getQuotePdfData, { quoteId });
    const [isExportingPdf, setIsExportingPdf] = useState(false);

    const quote = data?.quote as Doc<"quotes"> | undefined;
    const breakdown = useMemo<QuoteBreakdownItem[]>(() => {
        if (!data?.breakdown) return [];
        return data.breakdown.map((item) => ({
            label: item.label,
            amount: item.amount,
            currency: item.currency,
            notes: item.notes ?? undefined,
        }));
    }, [data?.breakdown]);

    const total = quote?.totalAmount ?? breakdown.reduce((sum, item) => sum + item.amount, 0);
    const currency = quote?.currency ?? "ILS";
    const projectId = quote?.projectId as Id<"projects"> | undefined;

    if (data === undefined) {
        return <div className="bg-white border rounded p-4 text-sm text-gray-500">Loading quote...</div>;
    }
    if (!quote) {
        return <div className="bg-white border rounded p-4 text-sm text-gray-500">No quote selected.</div>;
    }

    return (
        <div className="bg-white border rounded shadow-sm flex flex-col overflow-hidden h-[calc(100vh-12rem)]">
            <div className="p-4 border-b bg-gray-50 flex flex-wrap gap-3 justify-between items-center">
                <div>
                    <div className="text-sm font-semibold text-gray-900">Quote v{quote.version}</div>
                    <div className="text-xs text-gray-500">
                        Created {new Date(quote.createdAt).toLocaleString()}
                        {data.pdfUrl ? " · PDF ready" : ""}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100"
                        onClick={async () => {
                            const payload = [`Quote v${quote.version}`, `Total: ${total} ${currency}`, "", quote.clientDocumentText].join(
                                "\n"
                            );
                            await navigator.clipboard.writeText(payload);
                        }}
                    >
                        Copy
                    </button>
                    <button
                        type="button"
                        className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-50"
                        disabled={isExportingPdf}
                        onClick={async () => {
                            setIsExportingPdf(true);
                            try {
                                const response = await fetch("/api/quote-pdf", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ quoteId }),
                                });
                                if (!response.ok) {
                                    throw new Error(`PDF export failed: ${response.status}`);
                                }
                                const json = (await response.json()) as { pdfUrl?: string };
                                if (json.pdfUrl) {
                                    window.open(json.pdfUrl, "_blank", "noopener,noreferrer");
                                }
                            } finally {
                                setIsExportingPdf(false);
                            }
                        }}
                    >
                        {isExportingPdf ? "Exporting..." : "Export PDF"}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div>
                    <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Breakdown</h3>
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-gray-100 text-gray-600">
                            <tr>
                                <th className="p-2 border">Item</th>
                                <th className="p-2 border">Notes</th>
                                <th className="p-2 border text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {breakdown.map((item, i) => (
                                <tr key={i} className="border-b">
                                    <td className="p-2 border font-medium">{item.label}</td>
                                    <td className="p-2 border text-gray-500">{item.notes || "-"}</td>
                                    <td className="p-2 border text-right font-mono">
                                        {item.amount.toLocaleString()} {item.currency}
                                    </td>
                                </tr>
                            ))}
                            <tr className="bg-gray-50 font-bold">
                                <td className="p-2 border" colSpan={2}>
                                    Total
                                </td>
                                <td className="p-2 border text-right">
                                    {total.toLocaleString()} {currency}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div>
                    <h3 className="text-sm font-bold uppercase text-gray-500 mb-3">Client document</h3>
                    <div className="p-6 bg-white border shadow-sm rounded-lg whitespace-pre-wrap text-gray-800">
                        {quote.clientDocumentText}
                    </div>
                </div>

                {projectId && (
                    <div className="space-y-3">
                        <ImageGeneratorPanel
                            projectId={projectId}
                            entityType="quote"
                            entityId={String(quoteId)}
                            defaultPrompt={`Quote v${quote.version} - mood/reference image`}
                        />
                        <ImagePicker projectId={projectId} entityType="quote" entityId={String(quoteId)} />
                    </div>
                )}
            </div>
        </div>
    );
}
