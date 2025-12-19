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
        openaiImageModel: "gpt-image-1",
        geminiImageModel: "imagen-3.0-generate-002",
        quoteFooterHebrew: "",
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
        });
    }, [settings]);

    const hasChanges = useMemo(() => {
        if (!settings) return false;
        return (
            draft.imageProvider !== settings.imageProvider ||
            draft.openaiImageModel !== settings.openaiImageModel ||
            draft.geminiImageModel !== settings.geminiImageModel ||
            draft.quoteFooterHebrew !== settings.quoteFooterHebrew
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
                <p className="text-sm text-gray-600 mt-1">Configure image generation defaults and quote branding.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
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

                    <div className="pt-2 flex gap-2">
                        <button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={!hasChanges || isSaving}
                            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
                        >
                            {isSaving ? "Saving…" : "Save"}
                        </button>
                        {!hasChanges && (
                            <div className="text-sm text-gray-500 flex items-center">No changes</div>
                        )}
                    </div>
                </div>

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
            </div>
        </div>
    );
}

