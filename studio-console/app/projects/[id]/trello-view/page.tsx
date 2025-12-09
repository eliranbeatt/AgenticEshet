"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export default function TrelloViewPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    // API
    const config = useQuery(api.trelloSync.getConfig, { projectId });
    const saveConfig = useMutation(api.trelloSync.saveConfig);
    const fetchLists = useAction(api.trelloSync.fetchLists);
    const syncToTrello = useAction(api.trelloSync.sync);

    // State
    const [apiKey, setApiKey] = useState("");
    const [token, setToken] = useState("");
    const [boardId, setBoardId] = useState("");
    
    const [lists, setLists] = useState<any[]>([]);
    const [mappings, setMappings] = useState({ todo: "", in_progress: "", done: "" });
    const [isLoadingLists, setIsLoadingLists] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    // Load initial config
    useEffect(() => {
        if (config) {
            setApiKey(config.apiKey);
            setToken(config.token);
            setBoardId(config.boardId);
            setMappings(config.listMap || { todo: "", in_progress: "", done: "" });
        }
    }, [config]);

    const handleFetchLists = async () => {
        if (!apiKey || !token || !boardId) return alert("Please fill API credentials");
        setIsLoadingLists(true);
        try {
            const fetched = await fetchLists({ apiKey, token, boardId });
            setLists(fetched);
        } catch (err: any) {
            alert("Error fetching lists: " + err.message);
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
        } catch (err) {
            console.error(err);
            alert("Failed to save");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSync = async () => {
        if (!config) return alert("Please save configuration first.");
        setIsSyncing(true);
        try {
            const res = await syncToTrello({ projectId });
            alert(`Sync complete! Synced: ${res.syncedCount}, Errors: ${res.errors.length}`);
            if (res.errors.length > 0) {
                console.error("Sync errors:", res.errors);
            }
        } catch (err: any) {
            alert("Sync failed: " + err.message);
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto p-4 space-y-8">
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
        </div>
    );
}

function ListSelect({ label, lists, value, onChange }: { label: string, lists: any[], value: string, onChange: (v: string) => void }) {
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
