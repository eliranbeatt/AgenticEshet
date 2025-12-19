"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

type EntityType = "materialLine" | "task" | "quote";

export function ImageGeneratorPanel({
    projectId,
    entityType,
    entityId,
    defaultPrompt,
}: {
    projectId: Id<"projects">;
    entityType: EntityType;
    entityId: string;
    defaultPrompt?: string;
}) {
    const generateImage = useAction(api.assets.generateImage);
    const [prompt, setPrompt] = useState(defaultPrompt ?? "");
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="space-y-2">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Generate image</div>
            <div className="flex gap-2 items-end">
                <textarea
                    className="flex-1 border rounded px-3 py-2 text-sm resize-none min-h-[44px]"
                    placeholder="Describe the desired render (style, materials, colors, setting)..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                />
                <button
                    type="button"
                    className="bg-purple-600 text-white px-3 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                    disabled={!prompt.trim() || isGenerating}
                    onClick={async () => {
                        if (!prompt.trim()) return;
                        setIsGenerating(true);
                        setError(null);
                        try {
                            await generateImage({
                                projectId,
                                prompt: prompt.trim(),
                                size: "1024x1024",
                                linkTo: { entityType, entityId, role: "generated" },
                            });
                        } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                        } finally {
                            setIsGenerating(false);
                        }
                    }}
                >
                    {isGenerating ? "Generating..." : "Generate"}
                </button>
            </div>
            {error && <div className="text-xs text-red-600">{error}</div>}
        </div>
    );
}
