"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
        return data.breakdown.map((item: any) => ({
            label: item.label,
            amount: item.amount,
            currency: item.currency,
            notes: item.notes ?? undefined,
        }));
    }, [data?.breakdown]);

    const total = quote?.totalAmount ?? breakdown.reduce((sum: number, item: QuoteBreakdownItem) => sum + item.amount, 0);
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
                    <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <span>Quote v{quote.version}</span>
                        <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">Preview</span>
                    </div>
                    <div className="text-xs text-gray-500">
                        Created {new Date(quote.createdAt).toLocaleString()}
                        {data.pdfUrl ? " · PDF ready" : ""}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white hover:bg-gray-50 transition"
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
                        className="text-sm bg-blue-600 text-white border border-blue-700 rounded px-4 py-1.5 hover:bg-blue-700 transition disabled:opacity-50 shadow-sm"
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

            <div className="flex-1 overflow-y-auto p-8 space-y-10 bg-[#f9fafb]">
                {/* Visual Header Mockup */}
                <div className="p-8 bg-white border shadow-sm rounded-xl space-y-6">
                    <div className="flex justify-between items-start border-b pb-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black text-gray-900 tracking-tight">הצעת מחיר</h2>
                            <p className="text-sm text-gray-500 font-mono">#{quote._id.slice(-8).toUpperCase()}</p>
                        </div>
                        <div className="w-12 h-12 bg-gray-900 rounded-lg flex items-center justify-center text-white font-bold italic">S</div>
                    </div>

                    <div>
                        <h3 className="text-xs font-bold uppercase text-gray-400 mb-4 tracking-widest">Pricing Breakdown</h3>
                        <table className="w-full text-sm text-left border-collapse overflow-hidden rounded-lg">
                            <thead className="bg-gray-50 text-gray-600">
                                <tr>
                                    <th className="p-3 font-semibold">Item / Section</th>
                                    <th className="p-3 font-semibold">Notes</th>
                                    <th className="p-3 font-semibold text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {breakdown.map((item, i) => (
                                    <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition">
                                        <td className="p-3 font-medium text-gray-900">{item.label}</td>
                                        <td className="p-3 text-gray-500 italic text-xs">{item.notes || "-"}</td>
                                        <td className="p-3 text-right font-mono font-medium">
                                            {item.amount.toLocaleString()} {item.currency}
                                        </td>
                                    </tr>
                                ))}
                                <tr className="bg-gray-900 text-white font-bold">
                                    <td className="p-4 rounded-bl-lg" colSpan={2}>
                                        Total (Incl. VAT)
                                    </td>
                                    <td className="p-4 text-right rounded-br-lg font-mono text-lg">
                                        {total.toLocaleString()} {currency}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="pt-6 border-t font-hebrew">
                        <h3 className="text-xs font-bold uppercase text-gray-400 mb-4 tracking-widest">Document Content</h3>
                        <div dir="rtl" className="text-right prose prose-sm max-w-none text-gray-800 leading-relaxed font-hebrew">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {quote.clientDocumentText}
                            </ReactMarkdown>
                        </div>
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
