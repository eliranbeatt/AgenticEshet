"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export function ItemRevisionBanner({
    itemId,
    revisionId,
    revisionNumber,
    summaryMarkdown,
}: {
    itemId: Id<"projectItems">;
    revisionId: Id<"itemRevisions">;
    revisionNumber: number;
    summaryMarkdown?: string | null;
}) {
    const approveRevision = useMutation(api.items.approveRevision);
    const rejectRevision = useMutation(api.items.rejectRevision);

    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);

    return (
        <div className="border rounded-lg bg-amber-50 p-3 space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-amber-900">
                    Draft revision v{revisionNumber}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                        disabled={isApproving}
                        onClick={async () => {
                            setIsApproving(true);
                            try {
                                await approveRevision({ itemId, revisionId });
                            } finally {
                                setIsApproving(false);
                            }
                        }}
                    >
                        {isApproving ? "Approving..." : "Approve"}
                    </button>
                    <button
                        type="button"
                        className="text-xs px-3 py-1 rounded border border-amber-200 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                        disabled={isRejecting}
                        onClick={async () => {
                            if (!confirm("Reject this draft revision?")) return;
                            setIsRejecting(true);
                            try {
                                await rejectRevision({ itemId, revisionId });
                            } finally {
                                setIsRejecting(false);
                            }
                        }}
                    >
                        {isRejecting ? "Rejecting..." : "Reject"}
                    </button>
                </div>
            </div>
            {summaryMarkdown && (
                <div className="text-xs text-amber-800 whitespace-pre-wrap">{summaryMarkdown}</div>
            )}
        </div>
    );
}
