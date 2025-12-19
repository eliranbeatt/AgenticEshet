"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useMemo, useState } from "react";

type ImageProvider = "openai" | "gemini";

export default function AdminSettingsPage() {
    const settings = useQuery(api.settings.getAll, {});
    const saveSettings = useMutation(api.settings.setMany);
    const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);

    const [draft, setDraft] = useState({
        imageProvider: "openai" as ImageProvider,
        openaiImageModel: "gpt-image-1.5",
        geminiImageModel: "imagen-3.0-generate-002",
        quoteFooterHebrew: "",
        modelConfig: {} as Record<string, string>,
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isUploadingLogo, setIsUploadingLogo] = useState(false);

    useEffect(() => {
        if (!settings) return;
        setDraft({
            imageProvider: settings.imageProvider,
            openaiImageModel: settings.openaiImageModel,
            geminiImageModel: settings.geminiImageModel,
            quoteFooterHebrew: settings.quoteFooterHebrew,
            modelConfig: settings.modelConfig,
        });
    }, [settings]);

    const hasChanges = useMemo(() => {
        if (!settings) return false;
        return (
            draft.imageProvider !== settings.imageProvider ||
            draft.openaiImageModel !== settings.openaiImageModel ||
            draft.geminiImageModel !== settings.geminiImageModel ||
            draft.quoteFooterHebrew !== settings.quoteFooterHebrew ||
            JSON.stringify(draft.modelConfig) !== JSON.stringify(settings.modelConfig)
        );
    }, [draft, settings]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await saveSettings({
                imageProvider: draft.imageProvider,
                openaiImageModel: draft.openaiImageModel,
                geminiImageModel: draft.geminiImageModel,
                quoteFooterHebrew: draft.quoteFooterHebrew,
                modelConfig: JSON.stringify(draft.modelConfig),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save settings";
            alert(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogoUpload = async (file: File) => {
        setIsUploadingLogo(true);
        try {
            const postUrl = await generateUploadUrl();
            const result = await fetch(postUrl, {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
            });
            if (!result.ok) throw new Error(`Upload failed: ${result.statusText}`);
            const { storageId } = (await result.json()) as { storageId: string };
            await saveSettings({ brandingLogoStorageId: storageId });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to upload logo";
            alert(message);
        } finally {
            setIsUploadingLogo(false);
        }
    };

    const handleClearLogo = async () => {
        if (!confirm("Clear saved logo?")) return;
        await saveSettings({ brandingLogoStorageId: null });
    };

    return (
        <div className="space-y-6">
            <div className="bg-white border rounded p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Settings</h2>
                <p className="text-sm text-gray-600 mt-1">Configure image generation defaults, quote branding, and agent models.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-6">
                    <div className="bg-white border rounded p-6 shadow-sm space-y-4">
                        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Image provider</h3>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Provider</label>
                            <select
                                value={draft.imageProvider}
                                onChange={(e) =>
                                    setDraft((prev) => ({ ...prev, imageProvider: e.target.value as ImageProvider }))
                                }
                                className="w-full border rounded px-3 py-2 text-sm bg-white"
                            >
                                <option value="openai">OpenAI</option>
                                <option value="gemini">Gemini</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">OpenAI model</label>
                                <input
                                    value={draft.openaiImageModel}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, openaiImageModel: e.target.value }))}
                                    className="w-full border rounded px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Gemini model</label>
                                <input
                                    value={draft.geminiImageModel}
                                    onChange={(e) => setDraft((prev) => ({ ...prev, geminiImageModel: e.target.value }))}
                                    className="w-full border rounded px-3 py-2 text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white border rounded p-6 shadow-sm space-y-4">
                        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Agent Models</h3>
                        <p className="text-xs text-gray-500">Select the model to use for each agent stage.</p>

                        <div className="space-y-4">
                            {[
                                "ideation",
                                "clarification",
                                "planning",
                                "solutioning",
                                "tasks",
                                "quote",
                                "fixing_text",
                                "summarizing"
                            ].map((stage) => (
                                <div key={stage} className="grid grid-cols-3 items-center gap-4">
                                    <label className="text-sm font-medium text-gray-700 capitalize col-span-1">
                                        {stage.replace("_", " ")}
                                    </label>
                                    <select
                                        value={draft.modelConfig[stage] || "gpt-5.2"}
                                        onChange={(e) =>
                                            setDraft((prev) => ({
                                                ...prev,
                                                modelConfig: { ...prev.modelConfig, [stage]: e.target.value },
                                            }))
                                        }
                                        className="col-span-2 border rounded px-3 py-2 text-sm bg-white"
                                    >
                                        <option value="gpt-5.2">GPT-5.2 (Default)</option>
                                        <option value="gpt-5-mini">GPT-5 Mini</option>
                                        <option value="gpt-5-nano">GPT-5 Nano</option>
                                        <option value="gpt-4o">GPT-4o</option>
                                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white border rounded p-6 shadow-sm space-y-4">
                        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Branding</h3>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Logo</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="file"
                                    accept="image/*"
                                    disabled={isUploadingLogo}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        void handleLogoUpload(file);
                                        e.target.value = "";
                                    }}
                                    className="text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleClearLogo()}
                                    className="text-sm text-gray-600 hover:text-gray-900"
                                    disabled={!settings?.brandingLogoStorageId}
                                >
                                    Clear
                                </button>
                            </div>
                            {settings?.brandingLogoUrl && (
                                <div className="mt-3 border rounded p-3 bg-gray-50">
                                    <img
                                        src={settings.brandingLogoUrl}
                                        alt="Brand logo"
                                        className="max-h-16 object-contain"
                                    />
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Quote footer (Hebrew)</label>
                            <textarea
                                value={draft.quoteFooterHebrew}
                                onChange={(e) => setDraft((prev) => ({ ...prev, quoteFooterHebrew: e.target.value }))}
                                className="w-full border rounded px-3 py-2 text-sm font-mono h-32"
                                dir="rtl"
                                placeholder="טקסט תחתון להצעת מחיר…"
                            />
                            <div className="text-[11px] text-gray-500 mt-2">
                                Saved text is used by the quote PDF exporter (Phase 7).
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={!hasChanges || isSaving}
                            className="w-full bg-blue-600 text-white px-4 py-3 rounded text-sm font-medium disabled:opacity-50 shadow-sm hover:bg-blue-700 transition-colors"
                        >
                            {isSaving ? "Saving Settings…" : "Save All Changes"}
                        </button>
                        {!hasChanges && (
                            <div className="text-center text-sm text-gray-500 mt-2">No changes to save</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

