"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Doc } from "@/convex/_generated/dataModel";

export function PriceHistoryTable() {
    // For now, we just show the latest 50 observations globally.
    // In a real app, we'd have filters.
    const history = useQuery(api.prices.listLatestObservations, { limit: 50 }) as Array<Doc<"priceObservations">> | undefined;

    if (!history) {
        return <div>Loading price history...</div>;
    }

    return (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm uppercase tracking-wide text-gray-500">Price Memory</p>
                    <h2 className="text-lg font-semibold">Price Observations (Latest)</h2>
                </div>
            </div>

            <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Item</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Vendor</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Price</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Unit</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Date</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-500">Source</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {history.map((obs) => (
                            <tr key={obs._id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium text-gray-900">{obs.rawItemName}</td>
                                <td className="px-3 py-2 text-gray-700">{obs.vendorId ? String(obs.vendorId) : "-"}</td>
                                <td className="px-3 py-2 text-gray-700">
                                    {obs.unitPrice.toFixed(2)} {obs.currency}
                                </td>
                                <td className="px-3 py-2 text-gray-700">{obs.unit}</td>
                                <td className="px-3 py-2 text-gray-700">{new Date(obs.observedAt).toLocaleDateString()}</td>
                                <td className="px-3 py-2">
                                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600">
                                        {obs.source}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {history.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-sm">
                                    No price observations recorded yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
