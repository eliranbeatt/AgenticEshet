"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { RefreshCcw, CheckCircle, AlertCircle, Save, X } from "lucide-react";

type TrelloConfigModalProps = {
    projectId: Id<"projects">;
    onClose: () => void;
};

type TrelloList = {
    id: string;
    name: string;
};

type StatusMappings = Record<"todo" | "in_progress" | "blocked" | "done", string>;

const createEmptyMappings = (): StatusMappings => ({
    todo: "",
    in_progress: "",
    blocked: "",
    done: "",
});

export function TrelloConfigModal({ projectId, onClose }: TrelloConfigModalProps) {
    const config = useQuery(api.trelloSync.getConfig, { projectId });
    const verifyCredentials = useAction(api.trelloActions.verifyCredentials);
    const listBoards = useAction(api.trelloActions.listBoards);
    const createBoard = useAction(api.trelloActions.createBoard);
    const fetchLists = useAction(api.trelloActions.fetchLists);
    const saveConfig = useMutation(api.trelloSync.saveConfig);

    const [authStatus, setAuthStatus] = useState<"loading" | "success" | "error" | "null">("null");
    const [authMessage, setAuthMessage] = useState<string>("");

    const [boardMode, setBoardMode] = useState<"existing" | "new">("existing");
    const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingBoards, setIsLoadingBoards] = useState(false);

    // Form State
    const [selectedBoardId, setSelectedBoardId] = useState("");
    const [newBoardName, setNewBoardName] = useState("");
    const [mappings, setMappings] = useState<StatusMappings>(createEmptyMappings());
    const [boardLists, setBoardLists] = useState<TrelloList[]>([]);
    const [isLoadingLists, setIsLoadingLists] = useState(false);

    const [isSaving, setIsSaving] = useState(false);

    // Initial Load
    useEffect(() => {
        if (config) {
            setSelectedBoardId(config.boardId);
            setMappings({
                todo: config.listMap?.todo ?? "",
                in_progress: config.listMap?.in_progress ?? "",
                blocked: config.listMap?.blocked ?? "",
                done: config.listMap?.done ?? "",
            });
            // Auto fetch lists if board is set
            void fetchBoardLists(config.boardId);
            // Also fetch boards to populate dropdown
            void handleRefreshBoards();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config]);

    const handleTestConnection = async () => {
        setAuthStatus("loading");
        const result = await verifyCredentials({});
        if (result.success) {
            setAuthStatus("success");
            setAuthMessage(`Connected as @${result.username ?? "user"}`);
            // Also refresh boards
            void handleRefreshBoards();
        } else {
            setAuthStatus("error");
            setAuthMessage(result.error ?? "Authentication failed");
        }
    };

    const handleRefreshBoards = async () => {
        setIsLoadingBoards(true);
        try {
            const list = await listBoards({});
            setBoards(list || []);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingBoards(false);
        }
    };

    const fetchBoardLists = async (boardId: string) => {
        if (!boardId) return;
        setIsLoadingLists(true);
        try {
            const lists = await fetchLists({ boardId });
            const normalized = Array.isArray(lists)
                ? lists.map((list) => ({
                    id: String(list.id),
                    name: String(list.name ?? list.id),
                }))
                : [];
            setBoardLists(normalized);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoadingLists(false);
        }
    };

    const handleBoardChange = (id: string) => {
        setSelectedBoardId(id);
        void fetchBoardLists(id);
    };

    const handleSave = async () => {
        let finalBoardId = selectedBoardId;

        setIsSaving(true);
        try {
            if (boardMode === "new") {
                if (!newBoardName.trim()) {
                    alert("Please enter a name for the new board");
                    setIsSaving(false);
                    return;
                }
                const newBoard = await createBoard({ name: newBoardName });
                if (!newBoard || !newBoard.id) throw new Error("Failed to create board");
                finalBoardId = newBoard.id;
                // Wait a moment for lists to be generated or assume defaults?
                // Trello creates "To Do", "Doing", "Done" by default if requested.
                // We should probably just map them by name best effort or ask user to refresh?
                // For simplicity, let's fetch lists immediately.
                await fetchBoardLists(finalBoardId);
            }

            if (!finalBoardId) {
                alert("Please select or create a board");
                setIsSaving(false);
                return;
            }

            // If we just created a board, we might want to auto-map based on fetched lists
            // But 'setBoardLists' happens async.
            // Let's just save.
            await saveConfig({
                projectId,
                config: {
                    boardId: finalBoardId,
                    listMap: mappings,
                },
            });
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Failed to save: " + message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button
                type="button"
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                aria-label="Close modal"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-y-auto flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Trello Configuration</h2>
                        <p className="text-sm text-gray-500">Connect your project to a Trello board</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-6 space-y-8 flex-1">
                    {/* Connection Status */}
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold text-gray-700">Connection Status</span>
                            <button
                                onClick={handleTestConnection}
                                disabled={authStatus === "loading"}
                                className="text-xs flex items-center gap-1 bg-white border px-3 py-1 rounded hover:bg-gray-50 transition"
                            >
                                <RefreshCcw className={`w-3 h-3 ${authStatus === "loading" ? "animate-spin" : ""}`} />
                                {authStatus === "loading" ? "Checking..." : "Test Connection"}
                            </button>
                        </div>
                        {authStatus === "null" && (
                            <div className="text-xs text-gray-500">
                                Click test to verify <code>TRELLO_KEY</code> and <code>TRELLO_TOKEN</code> env vars.
                            </div>
                        )}
                        {authStatus === "success" && (
                            <div className="text-sm text-green-700 flex items-center gap-2">
                                <CheckCircle className="w-4 h-4" />
                                {authMessage}
                            </div>
                        )}
                        {authStatus === "error" && (
                            <div className="text-sm text-red-600 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {authMessage}
                            </div>
                        )}
                    </div>

                    {/* Board Selection */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-6 border-b pb-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="boardMode"
                                    checked={boardMode === "existing"}
                                    onChange={() => setBoardMode("existing")}
                                    className="text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-700">Select Existing Board</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="boardMode"
                                    checked={boardMode === "new"}
                                    onChange={() => setBoardMode("new")}
                                    className="text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm font-medium text-gray-700">Create New Board</span>
                            </label>
                        </div>

                        {boardMode === "existing" ? (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <select
                                        className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={selectedBoardId}
                                        onChange={(e) => handleBoardChange(e.target.value)}
                                        disabled={isLoadingBoards}
                                    >
                                        <option value="">-- Select a Board --</option>
                                        {boards.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={handleRefreshBoards}
                                        disabled={isLoadingBoards}
                                        className="px-3 border rounded-lg hover:bg-gray-50 text-gray-500"
                                        title="Refresh Boards"
                                    >
                                        <RefreshCcw className={`w-4 h-4 ${isLoadingBoards ? "animate-spin" : ""}`} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Enter new board name..."
                                    value={newBoardName}
                                    onChange={(e) => setNewBoardName(e.target.value)}
                                />
                                <p className="text-xs text-gray-500">Board will be created upon saving.</p>
                            </div>
                        )}
                    </div>

                    {/* List Mapping */}
                    {(selectedBoardId || boardMode === "existing") && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-bold text-gray-900">Map Status to Lists</h3>
                                {boardMode === "existing" && selectedBoardId && (
                                    <button
                                        onClick={() => fetchBoardLists(selectedBoardId)}
                                        disabled={isLoadingLists}
                                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                    >
                                        <RefreshCcw className={`w-3 h-3 ${isLoadingLists ? "animate-spin" : ""}`} />
                                        Refresh Lists
                                    </button>
                                )}
                            </div>

                            <div className="grid gap-3 bg-gray-50 p-4 rounded-lg border">
                                <ListSelect
                                    label="To Do"
                                    lists={boardLists}
                                    value={mappings.todo}
                                    onChange={(v) => setMappings(m => ({ ...m, todo: v }))}
                                />
                                <ListSelect
                                    label="In Progress"
                                    lists={boardLists}
                                    value={mappings.in_progress}
                                    onChange={(v) => setMappings(m => ({ ...m, in_progress: v }))}
                                />
                                <ListSelect
                                    label="Blocked"
                                    lists={boardLists}
                                    value={mappings.blocked}
                                    onChange={(v) => setMappings(m => ({ ...m, blocked: v }))}
                                />
                                <ListSelect
                                    label="Done"
                                    lists={boardLists}
                                    value={mappings.done}
                                    onChange={(v) => setMappings(m => ({ ...m, done: v }))}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg shadow hover:bg-slate-800 disabled:opacity-50 transition transform active:scale-95"
                    >
                        {isSaving ? (
                            <>Saving...</>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Save Configuration
                            </>
                        )}
                    </button>
                </div>
            </div>
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
                className="w-1/2 border rounded p-1 text-sm bg-white"
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
