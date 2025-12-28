"use client";

type SaveStatus = "idle" | "saving" | "saved";

type CurrentStatePanelProps = {
    text: string;
    onChange: (next: string) => void;
    onSubmit: (text: string) => void;
    isSubmitting: boolean;
    saveStatus: SaveStatus;
    updatedAt?: number;
    hasRemoteUpdate: boolean;
    onApplyRemote: () => void;
};

function formatTimestamp(value?: number) {
    if (!value) return "Not saved yet";
    return new Date(value).toLocaleTimeString();
}

export function CurrentStatePanel({
    text,
    onChange,
    onSubmit,
    isSubmitting,
    saveStatus,
    updatedAt,
    hasRemoteUpdate,
    onApplyRemote,
}: CurrentStatePanelProps) {
    return (
        <div className="flex flex-col h-full bg-white">
            <div className="p-3 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Current State</h3>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500">
                        <span>
                            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Idle"}
                        </span>
                        <span className="text-gray-400">Last: {formatTimestamp(updatedAt)}</span>
                        <button
                            type="button"
                            onClick={() => onSubmit(text)}
                            disabled={isSubmitting || text.trim().length === 0}
                            className="px-2 py-1 rounded uppercase bg-blue-600 text-white disabled:opacity-50"
                        >
                            {isSubmitting ? "Updating..." : "Update Facts"}
                        </button>
                    </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                    {hasRemoteUpdate && (
                        <button
                            type="button"
                            onClick={onApplyRemote}
                            className="px-2 py-1 text-[10px] rounded uppercase bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
                        >
                            Load latest update
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        Current Knowledge (Editable)
                    </div>
                    <textarea
                        className="w-full min-h-[320px] border rounded p-3 text-xs font-mono text-gray-800 resize-none"
                        value={text}
                        onChange={(event) => onChange(event.target.value)}
                        placeholder="Edit, add, or delete current knowledge here. Click 'Update Facts' to re-extract."
                    />
                </div>
            </div>
        </div>
    );
}
