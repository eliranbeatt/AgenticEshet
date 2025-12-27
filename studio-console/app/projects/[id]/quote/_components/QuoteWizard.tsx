"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { Sparkles, Loader2, MessageSquare, AlertCircle } from "lucide-react";
import { calculateSectionStats } from "@/src/lib/costing";

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
    selectedElementId,
    includeManagement,
    includeOptional,
    onCreated,
}: {
    projectId: Id<"projects">;
    selectedElementId?: Id<"projectItems"> | null;
    includeManagement?: boolean;
    includeOptional?: boolean;
    onCreated?: (quoteId: Id<"quotes">) => void;
}) {
    const accounting = useQuery(api.accounting.getProjectAccounting, { projectId });
    const itemsWithSpecs = useQuery(api.items.listApprovedWithSpecs, { projectId });
    const createFromWizard = useMutation(api.quotes.createFromWizard);

    const currency = (accounting?.project.currency as string | undefined) ?? "ILS";

    const baseItems = useMemo<Array<Omit<WizardItem, "selected" | "notes"> & { notes: string }>>(() => {
        if (!accounting?.sections && !itemsWithSpecs) return [];
        const rows = (accounting?.sections ?? []) as unknown as AccountingSectionRow[];
        const itemTotals = new Map<string, number>();
        const itemLabelFallback = new Map<string, string>();
        const unlinkedSections: AccountingSectionRow[] = [];
        const defaults = {
            overhead: accounting?.project.overheadPercent ?? 0.15,
            risk: accounting?.project.riskPercent ?? 0.1,
            profit: accounting?.project.profitPercent ?? 0.3,
        };
        const options = {
            includeManagement: includeManagement ?? false,
            includeOptional: includeOptional ?? false,
            respectVisibility: true,
        };

        for (const row of rows) {
            const amount = Number(
                calculateSectionStats(row.section, row.materials ?? [], row.work ?? [], defaults, options)
                    .plannedClientPrice
            );
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

        const itemsById = new Map((itemsWithSpecs ?? []).map((entry) => [entry.item._id, entry]));
        const itemLines = (itemsWithSpecs ?? [])
            .map((entry) => {
                const itemId = String(entry.item._id);
                if (selectedElementId && String(selectedElementId) !== itemId) return null;
                const includeInQuote = entry.spec.quote?.includeInQuote ?? true;
                if (!includeInQuote) return null;
                const amount = itemTotals.get(itemId) ?? 0;
                const label =
                    entry.spec.quote?.clientTextOverride?.trim() ||
                    entry.item.title ||
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

        const sectionLines = selectedElementId
            ? []
            : unlinkedSections
            .map((row) => {
                const section = row.section;
                const amount = Number(row.stats?.plannedClientPrice ?? 0);
                return {
                    key: `section:${section._id}`,
                    label: `${section.group}: ${section.name}`,
                    amount,
                    currency,
                    notes: "",
                };
            })
            .filter((item) => item.amount > 0);

        return [...itemLines, ...sectionLines];
    }, [accounting?.sections, accounting?.project, currency, includeManagement, includeOptional, itemsWithSpecs, selectedElementId]);

    const [excludedKeys, setExcludedKeys] = useState<Set<string>>(() => new Set());
    const [amountOverrides, setAmountOverrides] = useState<Record<string, number>>({});
    const [notesOverrides, setNotesOverrides] = useState<Record<string, string>>({});
    const [customItems, setCustomItems] = useState<WizardItem[]>([]);
    const [clientNotes, setClientNotes] = useState("");
    const [customLabel, setCustomLabel] = useState("");
    const [customAmount, setCustomAmount] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // Agent State
    const [agentInstructions, setAgentInstructions] = useState("");
    const [isAgentRunning, setIsAgentRunning] = useState(false);
    const [lastAgentRunId, setLastAgentRunId] = useState<Id<"agentRuns"> | null>(null);
    const runAgent = useAction(api.agents.quote.run);
    const agentRun = useQuery(api.agentRuns.get, lastAgentRunId ? { runId: lastAgentRunId } : "skip");

    useEffect(() => {
        if (agentRun?.status === "succeeded" || agentRun?.status === "failed") {
            setIsAgentRunning(false);
        }
    }, [agentRun?.status]);

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
    const selectedQuoteItems = useMemo(() => selectedItems.filter((i) => i.amount > 0), [selectedItems]);

    const total = useMemo(() => selectedQuoteItems.reduce((sum, i) => sum + i.amount, 0), [selectedQuoteItems]);

    return (
        <div className="bg-white border rounded shadow-sm p-4 space-y-4">
            <div className="space-y-4">
                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="p-1.5 bg-indigo-600 rounded-lg text-white">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <h3 className="font-bold text-indigo-900">Agent-Guided Quote</h3>
                    </div>
                    <p className="text-sm text-indigo-800/80 mb-4 leading-relaxed">
                        The Quotes Agent will analyze your project scope, accounting, and client details to draft a professional markdown document.
                    </p>

                    <div className="space-y-3">
                        <textarea
                            className="w-full border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[80px] bg-white/50"
                            placeholder="Special instructions (e.g. 'Focus on the visual design phase', 'Mention the 10% discount we discussed'...)"
                            value={agentInstructions}
                            onChange={(e) => setAgentInstructions(e.target.value)}
                        />
                        <button
                            type="button"
                            disabled={isAgentRunning}
                            onClick={async () => {
                                setIsAgentRunning(true);
                                try {
                                    const result = await runAgent({
                                        projectId,
                                        instructions: agentInstructions,
                                    });
                                    setLastAgentRunId(result.runId);
                                } catch (err) {
                                    console.error(err);
                                    setIsAgentRunning(false);
                                }
                            }}
                            className="w-full bg-indigo-600 text-white rounded-lg px-4 py-2.5 text-sm font-bold shadow-md hover:bg-indigo-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isAgentRunning ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Agent is drafting...
                                </>
                            ) : (
                                "Generate Draft with AI"
                            )}
                        </button>
                    </div>

                    {agentRun && (
                        <div className="mt-4 pt-4 border-t border-indigo-100 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs font-semibold">
                                <span className={`w-2 h-2 rounded-full ${agentRun.status === "running" ? "bg-blue-500 animate-pulse" :
                                    agentRun.status === "succeeded" ? "bg-green-500" :
                                        agentRun.status === "failed" ? "bg-red-500" : "bg-gray-400"
                                    }`} />
                                <span className="text-indigo-900 uppercase tracking-wider">{agentRun.status}</span>
                            </div>
                            <span className="text-[10px] text-indigo-700/60 font-mono">{agentRun.stage || "initializing"}</span>
                        </div>
                    )}
                </div>

                <div className="relative">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                        <div className="w-full border-t border-gray-200"></div>
                    </div>
                    <div className="relative flex justify-center">
                        <span className="bg-white px-3 text-xs font-bold text-gray-400 uppercase tracking-widest">or manual builder</span>
                    </div>
                </div>
            </div>

            <div className="space-y-4 opacity-80 hover:opacity-100 transition">
                <div>
                    <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Manual Wizard</h2>
                    <p className="text-xs text-gray-500 mt-1">
                        Select scope and override prices manually.
                    </p>
                </div>

                {accounting === undefined ? (
                    <div className="text-sm text-gray-500">Loading accounting...</div>
                ) : (
                    <div className="space-y-2">
                        {baseItems.length === 0 ? (
                            <div className="text-sm text-gray-500">No items or priced sections yet.</div>
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
                        disabled={isSaving || selectedQuoteItems.length === 0}
                        onClick={async () => {
                            setIsSaving(true);
                            try {
                                const result = await createFromWizard({
                                    projectId,
                                    currency,
                                    breakdown: selectedQuoteItems.map((i) => ({
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
        </div>
    );
}
