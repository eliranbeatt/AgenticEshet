"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, type Doc } from "../../../convex/_generated/dataModel";

type ProfileFormState = {
    name: string;
    description: string;
    llmModel: string;
    useWebSearch: boolean;
    useCodeInterpreter: boolean;
    systemPrompt: string;
    schemaJson: string;
};

const defaultProfile: ProfileFormState = {
    name: "",
    description: "",
    llmModel: "gpt-4o-mini",
    useWebSearch: false,
    useCodeInterpreter: false,
    systemPrompt: "",
    schemaJson: "{}",
};

export default function EnrichmentAdminPage() {
    const profiles = useQuery(api.admin.listEnrichmentProfiles, {});
    const saveProfile = useMutation(api.admin.saveEnrichmentProfile);
    const deleteProfile = useMutation(api.admin.deleteEnrichmentProfile);

    const [selectedId, setSelectedId] = useState<Id<"enrichmentProfiles"> | null>(null);
    const [form, setForm] = useState<ProfileFormState>(defaultProfile);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const selectedProfile = useMemo<Doc<"enrichmentProfiles"> | null>(
        () => profiles?.find((profile: Doc<"enrichmentProfiles">) => profile._id === selectedId) ?? null,
        [profiles, selectedId],
    );

    useEffect(() => {
        if (!selectedProfile) {
            setForm(defaultProfile);
            return;
        }
        setForm({
            name: selectedProfile.name,
            description: selectedProfile.description,
            llmModel: selectedProfile.llmModel,
            useWebSearch: selectedProfile.useWebSearch,
            useCodeInterpreter: selectedProfile.useCodeInterpreter,
            systemPrompt: selectedProfile.systemPrompt,
            schemaJson: selectedProfile.schemaJson,
        });
    }, [selectedProfile]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsSaving(true);
        try {
            await saveProfile({
                profileId: selectedProfile?._id,
                ...form,
            });
            setSelectedId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save profile";
            alert(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedProfile) return;
        if (!confirm(`Delete profile ${selectedProfile.name}?`)) return;
        setIsDeleting(true);
        try {
            await deleteProfile({ profileId: selectedProfile._id });
            setSelectedId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete profile";
            alert(message);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
            <div className="bg-white border rounded-lg shadow-sm">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Enrichment Profiles</h2>
                    <button
                        onClick={() => setSelectedId(null)}
                        className="text-sm text-blue-600 hover:underline"
                    >
                        + New Profile
                    </button>
                </div>
                <div className="max-h-[540px] overflow-y-auto divide-y">
                    {profiles?.map((profile: Doc<"enrichmentProfiles">) => (
                        <button
                            key={profile._id}
                            onClick={() => setSelectedId(profile._id)}
                            className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedProfile?._id === profile._id ? "bg-blue-50" : ""}`}
                        >
                            <div className="flex justify-between text-sm font-medium text-gray-800">
                                <span>{profile.name}</span>
                                <span className="text-xs uppercase text-gray-500">{profile.llmModel}</span>
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2 mt-1">{profile.description}</p>
                        </button>
                    ))}
                    {(!profiles || profiles.length === 0) && (
                        <div className="p-4 text-sm text-gray-500">No profiles defined yet.</div>
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        {selectedProfile ? `Edit ${selectedProfile.name}` : "Create new profile"}
                    </h2>
                    {selectedProfile && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="text-sm text-red-500 hover:underline disabled:opacity-50"
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="text-sm text-gray-700 space-y-1">
                        <span>Name</span>
                        <input
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </label>
                    <label className="text-sm text-gray-700 space-y-1">
                        <span>Model</span>
                        <input
                            value={form.llmModel}
                            onChange={(e) => setForm((prev) => ({ ...prev, llmModel: e.target.value }))}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </label>
                </div>

                <label className="text-sm text-gray-700 space-y-1 block">
                    <span>Description</span>
                    <input
                        value={form.description}
                        onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm"
                    />
                </label>

                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={form.useWebSearch}
                            onChange={(e) => setForm((prev) => ({ ...prev, useWebSearch: e.target.checked }))}
                        />
                        Use web search
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={form.useCodeInterpreter}
                            onChange={(e) => setForm((prev) => ({ ...prev, useCodeInterpreter: e.target.checked }))}
                        />
                        Use code interpreter
                    </label>
                </div>

                <label className="text-sm text-gray-700 space-y-1 block">
                    <span>System Prompt</span>
                    <textarea
                        value={form.systemPrompt}
                        onChange={(e) => setForm((prev) => ({ ...prev, systemPrompt: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm h-32"
                        required
                    />
                </label>

                <label className="text-sm text-gray-700 space-y-1 block">
                    <span>Schema (JSON)</span>
                    <textarea
                        value={form.schemaJson}
                        onChange={(e) => setForm((prev) => ({ ...prev, schemaJson: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm h-32 font-mono"
                    />
                </label>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-semibold disabled:opacity-50"
                    >
                        {isSaving ? "Saving..." : "Save Profile"}
                    </button>
                </div>
            </form>
        </div>
    );
}
