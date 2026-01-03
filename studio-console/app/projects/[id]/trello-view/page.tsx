"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

type TrelloList = {
    id: string;
    name: string;
};

type StatusMappings = Record<"todo" | "in_progress" | "blocked" | "done", string>;

type SnapshotList = {
    id: string;
    name: string;
    cards: {
        id: string;
        name: string;
        shortUrl?: string;
    }[];
};

const createEmptyMappings = (): StatusMappings => ({
    todo: "",
    in_progress: "",
    blocked: "",
    done: "",
});

export default function TrelloViewPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    // API
    const config = useQuery(api.trelloSync.getConfig, { projectId });
    const syncState = useQuery(api.trelloSync.getSyncState, { projectId });
    const saveConfig = useMutation(api.trelloSync.saveConfig);
    const fetchLists = useAction(api.trelloActions.fetchLists);
    const syncToTrello = useAction(api.trelloActions.sync);
    const snapshotBoard = useAction(api.trelloActions.snapshotBoard);

    // State
    const [apiKey, setApiKey] = useState("");
    const [token, setToken] = useState("");
    const [boardId, setBoardId] = useState("");

    const [lists, setLists] = useState<TrelloList[]>([]);
    const [mappings, setMappings] = useState<StatusMappings>(createEmptyMappings());
    const [isLoadingLists, setIsLoadingLists] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [snapshot, setSnapshot] = useState<SnapshotList[]>([]);
    const [snapshotRetries, setSnapshotRetries] = useState<string[]>([]);
    const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);

    // Load initial config
    useEffect(() => {
        if (config) {
            setApiKey(config.apiKey);
            setToken(config.token);
            setBoardId(config.boardId);
            setMappings({
                todo: config.listMap?.todo ?? "",
                in_progress: config.listMap?.in_progress ?? "",
                blocked: config.listMap?.blocked ?? "",
                done: config.listMap?.done ?? "",
            });
        }
    }, [config]);

    const handleFetchLists = async () => {
        if (!apiKey || !token || !boardId) return alert("Please fill API credentials");
        setIsLoadingLists(true);
        try {
            const fetched = await fetchLists({ apiKey, token, boardId });
            const normalized: TrelloList[] = Array.isArray(fetched)
                ? fetched.map((list) => ({
                    id: String(list.id),
                    name: String(list.name ?? list.id),
                }))
                : [];
            setLists(normalized);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Error fetching lists: " + message);
        } finally {
            setIsLoadingLists(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveConfig({
                projectId,
                config: {
                    apiKey,
                    token,
                    boardId,
                    listMap: mappings,
                }
            });
            alert("Configuration saved!");
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Unknown error";
            alert(`Failed to save: ${message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const handleSync = async () => {
        if (!config) return alert("Please save configuration first.");
        setIsSyncing(true);
        try {
            const res = await syncToTrello({ projectId });
            const retryNote = res.retries?.length ? ` (with ${res.retries.length} retry${res.retries.length === 1 ? "" : "s"})` : "";
            alert(`Sync complete! Synced: ${res.syncedCount}, Archived: ${res.archivedCount}${retryNote}, Errors: ${res.errors.length}`);
            if (res.errors.length > 0) {
                console.error("Sync errors:", res.errors);
            }
            if (res.retries?.length) {
                console.warn("Trello retry log:", res.retries);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Sync failed: " + message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSnapshot = async () => {
        if (!config) return alert("Please save configuration first.");
        setIsSnapshotLoading(true);
        try {
            const result = await snapshotBoard({ projectId });
            setSnapshot(result.lists || []);
            setSnapshotRetries(result.retries || []);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Failed to load snapshot: " + message);
        } finally {
            setIsSnapshotLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto p-4 space-y-8">
            <div className="grid gap-4 lg:grid-cols-3">
                <div className="bg-white p-4 rounded shadow border lg:col-span-2">
                    <h2 className="text-lg font-bold mb-2">Sync Status</h2>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <StatusStat label="Last Sync" value={syncState?.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString() : "Never"} />
                        <StatusStat label="Mapped Tasks" value={`${syncState?.mappedTaskCount ?? 0}/${syncState?.totalTasks ?? 0}`} />
                        <StatusStat label="Unmapped Tasks" value={syncState?.unmappedTasks ?? 0} />
                        <StatusStat label="Board Snapshot" value={snapshot.length > 0 ? `${snapshot.reduce((sum, list) => sum + list.cards.length, 0)} cards loaded` : "Tap Refresh"} />
                    </div>
                </div>
                <div className="bg-white p-4 rounded shadow border flex flex-col gap-3">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-600">Snapshot</h3>
                        <p className="text-xs text-gray-500">Pull the latest board state directly from Trello.</p>
                    </div>
                    <button
                        onClick={handleSnapshot}
                        disabled={isSnapshotLoading || !config}
                        className="bg-slate-900 text-white px-4 py-2 rounded font-medium disabled:opacity-40"
                    >
                        {isSnapshotLoading ? "Fetching..." : "Refresh Snapshot"}
                    </button>
                    {snapshotRetries.length > 0 && (
                        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                            Retried {snapshotRetries.length} API calls. See console for full log.
                        </p>
                    )}
                </div>
            </div>

            <div className="bg-white p-6 rounded shadow border">
                <h2 className="text-xl font-bold mb-4">Trello Configuration</h2>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">API Key</label>
                            <input
                                type="password"
                                className="w-full border rounded p-2 mt-1"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">Token</label>
                            <input
                                type="password"
                                className="w-full border rounded p-2 mt-1"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Board ID</label>
                        <div className="flex gap-2 mt-1">
                            <input
                                type="text"
                                className="flex-1 border rounded p-2"
                                value={boardId}
                                onChange={(e) => setBoardId(e.target.value)}
                            />
                            <button
                                onClick={handleFetchLists}
                                disabled={isLoadingLists}
                                className="bg-gray-100 px-4 rounded hover:bg-gray-200 border"
                            >
                                {isLoadingLists ? "Loading..." : "Fetch Lists"}
                            </button>
                        </div>
                    </div>

                    {lists.length > 0 && (
                        <div className="bg-gray-50 p-4 rounded border">
                            <h3 className="font-bold text-sm mb-3">Map Status to Trello Lists</h3>
                            <div className="space-y-3">
                                <ListSelect
                                    label="To Do"
                                    lists={lists}
                                    value={mappings.todo}
                                    onChange={(v) => setMappings(m => ({ ...m, todo: v }))}
                                />
                                <ListSelect
                                    label="In Progress"
                                    lists={lists}
                                    value={mappings.in_progress}
                                    onChange={(v) => setMappings(m => ({ ...m, in_progress: v }))}
                                />
                                <ListSelect
                                    label="Blocked"
                                    lists={lists}
                                    value={mappings.blocked}
                                    onChange={(v) => setMappings(m => ({ ...m, blocked: v }))}
                                />
                                <ListSelect
                                    label="Done"
                                    lists={lists}
                                    value={mappings.done}
                                    onChange={(v) => setMappings(m => ({ ...m, done: v }))}
                                />
                            </div>
                        </div>
                    )}

                    <div className="pt-4 flex justify-end">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-blue-600 text-white px-6 py-2 rounded font-medium disabled:opacity-50"
                        >
                            {isSaving ? "Saving..." : "Save Configuration"}
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded shadow border text-center">
                <h2 className="text-xl font-bold mb-2">Sync Engine</h2>
                <p className="text-gray-500 mb-6">Push current project tasks to the configured Trello Board.</p>

                <button
                    onClick={handleSync}
                    disabled={isSyncing || !config}
                    className="bg-green-600 text-white px-8 py-3 rounded-lg font-bold text-lg disabled:opacity-50 hover:bg-green-700 shadow"
                >
                    {isSyncing ? "Syncing..." : "Sync Now"}
                </button>

                {!config && <p className="text-red-500 text-sm mt-2">Configuration required first.</p>}
            </div>

            {snapshot.length > 0 && (
                <div className="bg-white p-6 rounded shadow border">
                    <h2 className="text-xl font-bold mb-4">Live Board Snapshot</h2>
                    <div className="grid gap-4 md:grid-cols-2">
                        {snapshot.map((list) => (
                            <div key={list.id} className="border rounded p-4">
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="font-semibold text-gray-800">{list.name}</h3>
                                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                        {list.cards.length} cards
                                    </span>
                                </div>
                                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                    {list.cards.map((card) => (
                                        <div key={card.id} className="text-sm border rounded px-3 py-2 hover:bg-gray-50">
                                            <p className="font-medium text-gray-800">{card.name}</p>
                                            {card.shortUrl && (
                                                <a
                                                    href={card.shortUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-xs text-blue-600 hover:underline"
                                                >
                                                    Open Card
                                                </a>
                                            )}
                                        </div>
                                    ))}
                                    {list.cards.length === 0 && (
                                        <p className="text-xs text-gray-400 border border-dashed rounded px-3 py-2 text-center">
                                            No open cards in this list
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function ListSelect({
    label,
    lists,
    value,
    onChange,
}: {
    label: string;
    lists: TrelloList[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">{label}</span>
            <select
                className="w-1/2 border rounded p-1 text-sm"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">-- Select List --</option>
                {lists.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                ))}
            </select>
        </div>
    );
}

function StatusStat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="bg-gray-50 border rounded p-3">
            <p className="text-xs uppercase text-gray-500">{label}</p>
            <p className="font-semibold text-gray-900">{value}</p>
        </div>
    );
}
