"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

type WizardItem = {
    key: string;
    label: string;
    amount: number;
    currency: string;
    notes: string;
    selected: boolean;
};

type AccountingSectionRow = {
    section: Doc<"sections">;
    stats: { plannedClientPrice?: number };
    item?: Doc<"projectItems"> | null;
};

export function QuoteWizard({
    projectId,
    onCreated,
}: {
    projectId: Id<"projects">;
    onCreated?: (quoteId: Id<"quotes">) => void;
}) {
    const accounting = useQuery(api.accounting.getProjectAccounting, { projectId });
    const itemsWithSpecs = useQuery(api.items.listApprovedWithSpecs, { projectId });
    const createFromWizard = useMutation(api.quotes.createFromWizard);

    const currency = (accounting?.project.currency as string | undefined) ?? "ILS";

    const baseItems = useMemo<Array<Omit<WizardItem, "selected" | "notes"> & { notes: string }>>(() => {
        if (!accounting?.sections) return [];
        const rows = accounting.sections as unknown as AccountingSectionRow[];
        const itemTotals = new Map<string, number>();
        const itemLabelFallback = new Map<string, string>();
        const unlinkedSections: AccountingSectionRow[] = [];

        for (const row of rows) {
            const amount = Number(row.stats?.plannedClientPrice ?? 0);
            if (amount <= 0) continue;
            if (row.section.itemId) {
                const key = String(row.section.itemId);
                itemTotals.set(key, (itemTotals.get(key) ?? 0) + amount);
                if (row.item?.title) {
                    itemLabelFallback.set(key, row.item.title);
                }
            } else {
                unlinkedSections.push(row);
            }
        }

        const itemsById = new Map(
            (itemsWithSpecs ?? []).map((entry) => [entry.item._id, entry]),
        );

        const itemLines = Array.from(itemTotals.entries())
            .map(([itemId, amount]) => {
                const entry = itemsById.get(itemId);
                const includeInQuote = entry?.spec.quote?.includeInQuote ?? true;
                if (!includeInQuote || amount <= 0) return null;
                const label =
                    entry?.spec.quote?.clientTextOverride?.trim() ||
                    entry?.item.title ||
                    itemLabelFallback.get(itemId) ||
                    "Item";
                return {
                    key: `item:${itemId}`,
                    label,
                    amount,
                    currency,
                    notes: "",
                };
            })
            .filter(Boolean) as Array<Omit<WizardItem, "selected" | "notes"> & { notes: string }>;

        const sectionLines = unlinkedSections.map((row) => {
            const section = row.section;
            const amount = Number(row.stats?.plannedClientPrice ?? 0);
            return {
                key: `section:${section._id}`,
                label: `${section.group}: ${section.name}`,
                amount,
                currency,
                notes: "",
            };
        });

        return [...itemLines, ...sectionLines].filter((item) => item.amount > 0);
    }, [accounting?.sections, currency, itemsWithSpecs]);

    const [excludedKeys, setExcludedKeys] = useState<Set<string>>(() => new Set());
    const [amountOverrides, setAmountOverrides] = useState<Record<string, number>>({});
    const [notesOverrides, setNotesOverrides] = useState<Record<string, string>>({});
    const [customItems, setCustomItems] = useState<WizardItem[]>([]);
    const [clientNotes, setClientNotes] = useState("");
    const [customLabel, setCustomLabel] = useState("");
    const [customAmount, setCustomAmount] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const selectedBaseItems = useMemo(() => {
        return baseItems
            .filter((i) => !excludedKeys.has(i.key))
            .map((i) => ({
                ...i,
                amount: amountOverrides[i.key] ?? i.amount,
                notes: notesOverrides[i.key] ?? i.notes,
                selected: true,
            }));
    }, [amountOverrides, baseItems, excludedKeys, notesOverrides]);

    const selectedCustomItems = useMemo(() => customItems.filter((i) => i.selected), [customItems]);
    const selectedItems = useMemo(() => [...selectedBaseItems, ...selectedCustomItems], [selectedBaseItems, selectedCustomItems]);

    const total = useMemo(() => selectedItems.reduce((sum, i) => sum + i.amount, 0), [selectedItems]);

    return (
        <div className="bg-white border rounded shadow-sm p-4 space-y-4">
            <div>
                <h2 className="text-lg font-semibold text-gray-900">Quote wizard</h2>
                <p className="text-sm text-gray-600 mt-1">
                    Select scope + client prices. This flow does not expose internal costs/margins to the quote writer.
                </p>
            </div>

            {accounting === undefined ? (
                <div className="text-sm text-gray-500">Loading accounting...</div>
            ) : (
                <div className="space-y-2">
                    {baseItems.length === 0 ? (
                        <div className="text-sm text-gray-500">No priced sections yet.</div>
                    ) : (
                        baseItems.map((item) => (
                            <div key={item.key} className="flex items-center gap-2 border rounded p-2">
                                <input
                                    type="checkbox"
                                    checked={!excludedKeys.has(item.key)}
                                    onChange={(e) => {
                                        const next = new Set(excludedKeys);
                                        if (e.target.checked) next.delete(item.key);
                                        else next.add(item.key);
                                        setExcludedKeys(next);
                                    }}
                                />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-gray-900">{item.label}</div>
                                    <input
                                        className="w-full mt-1 border rounded px-2 py-1 text-xs"
                                        placeholder="Notes (optional)"
                                        value={notesOverrides[item.key] ?? ""}
                                        onChange={(e) => {
                                            setNotesOverrides({ ...notesOverrides, [item.key]: e.target.value });
                                        }}
                                    />
                                </div>
                                <input
                                    className="w-28 border rounded px-2 py-1 text-sm text-right"
                                    inputMode="decimal"
                                    value={String(amountOverrides[item.key] ?? item.amount)}
                                    onChange={(e) => {
                                        const amount = Number(e.target.value);
                                        setAmountOverrides({ ...amountOverrides, [item.key]: Number.isFinite(amount) ? amount : 0 });
                                    }}
                                />
                                <div className="text-xs text-gray-500 w-10">{item.currency}</div>
                            </div>
                        ))
                    )}
                </div>
            )}

            <div className="border-t pt-4 space-y-2">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Add custom line</div>
                <div className="flex gap-2">
                    <input
                        className="flex-1 border rounded px-3 py-2 text-sm"
                        placeholder="Label"
                        value={customLabel}
                        onChange={(e) => setCustomLabel(e.target.value)}
                    />
                    <input
                        className="w-32 border rounded px-3 py-2 text-sm text-right"
                        placeholder="Amount"
                        inputMode="decimal"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                    />
                    <button
                        type="button"
                        className="border rounded px-3 py-2 text-sm bg-white hover:bg-gray-50 disabled:opacity-50"
                        disabled={!customLabel.trim() || !customAmount.trim()}
                        onClick={() => {
                            const amount = Number(customAmount);
                            if (!Number.isFinite(amount) || amount <= 0) return;
                            setCustomItems([
                                ...customItems,
                                {
                                    key: `custom:${Date.now()}`,
                                    label: customLabel.trim(),
                                    amount,
                                    currency,
                                    notes: "",
                                    selected: true,
                                },
                            ]);
                            setCustomLabel("");
                            setCustomAmount("");
                        }}
                    >
                        Add
                    </button>
                </div>
            </div>

            {customItems.length > 0 && (
                <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Custom lines</div>
                    <div className="space-y-2">
                        {customItems.map((item, idx) => (
                            <div key={item.key} className="flex items-center gap-2 border rounded p-2">
                                <input
                                    type="checkbox"
                                    checked={item.selected}
                                    onChange={(e) => {
                                        const next = [...customItems];
                                        next[idx] = { ...item, selected: e.target.checked };
                                        setCustomItems(next);
                                    }}
                                />
                                <input
                                    className="flex-1 border rounded px-2 py-1 text-sm"
                                    value={item.label}
                                    onChange={(e) => {
                                        const next = [...customItems];
                                        next[idx] = { ...item, label: e.target.value };
                                        setCustomItems(next);
                                    }}
                                />
                                <input
                                    className="w-28 border rounded px-2 py-1 text-sm text-right"
                                    inputMode="decimal"
                                    value={String(item.amount)}
                                    onChange={(e) => {
                                        const amount = Number(e.target.value);
                                        const next = [...customItems];
                                        next[idx] = { ...item, amount: Number.isFinite(amount) ? amount : 0 };
                                        setCustomItems(next);
                                    }}
                                />
                                <button
                                    type="button"
                                    className="text-xs text-red-600 hover:text-red-800"
                                    onClick={() => setCustomItems(customItems.filter((_, i) => i !== idx))}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Client notes</div>
                <textarea
                    className="w-full border rounded px-3 py-2 text-sm resize-none min-h-[90px]"
                    placeholder="Optional footer / terms / scope notes..."
                    value={clientNotes}
                    onChange={(e) => setClientNotes(e.target.value)}
                />
            </div>

            <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700">
                    Total: <span className="font-semibold">{total.toLocaleString()}</span> {currency}
                </div>
                <button
                    type="button"
                    className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    disabled={isSaving || selectedItems.length === 0}
                    onClick={async () => {
                        setIsSaving(true);
                        try {
                            const result = await createFromWizard({
                                projectId,
                                currency,
                                breakdown: selectedItems.map((i) => ({
                                    label: i.label,
                                    amount: i.amount,
                                    currency: i.currency,
                                    notes: i.notes.trim() ? i.notes.trim() : null,
                                })),
                                notesToClient: clientNotes.trim() ? clientNotes.trim() : undefined,
                            });
                            onCreated?.(result.quoteId);
                            setClientNotes("");
                        } finally {
                            setIsSaving(false);
                        }
                    }}
                >
                    {isSaving ? "Creating..." : "Create quote version"}
                </button>
            </div>
        </div>
    );
}
