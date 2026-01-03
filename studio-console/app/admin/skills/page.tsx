"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id, type Doc } from "../../../convex/_generated/dataModel";

type SkillFormState = {
    name: string;
    type: string;
    content: string;
    metadataJson: string;
    skillKey: string;
    enabled: boolean;
};

const emptyForm: SkillFormState = {
    name: "",
    type: "agent_system",
    content: "",
    metadataJson: "{}",
    skillKey: "",
    enabled: true,
};

export default function SkillsAdminPage() {
    const skills = useQuery(api.admin.listSkills, {});
    const saveSkill = useMutation(api.admin.saveSkill);
    const deleteSkill = useMutation(api.admin.deleteSkill);

    const [selectedId, setSelectedId] = useState<Id<"skills"> | null>(null);
    const [form, setForm] = useState<SkillFormState>(emptyForm);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const selectedSkill = useMemo<Doc<"skills"> | null>(
        () => skills?.find((skill: Doc<"skills">) => skill._id === selectedId) ?? null,
        [skills, selectedId],
    );

    useEffect(() => {
        if (!selectedSkill) {
            setForm(emptyForm);
            return;
        }
        setForm({
            name: selectedSkill.name,
            type: selectedSkill.type,
            content: selectedSkill.content,
            metadataJson: selectedSkill.metadataJson,
            skillKey: selectedSkill.skillKey ?? "",
            enabled: selectedSkill.enabled ?? true,
        });
    }, [selectedSkill]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setIsSaving(true);
        try {
            await saveSkill({
                skillId: selectedSkill?._id,
                name: form.name.trim(),
                type: form.type,
                content: form.content,
                metadataJson: form.metadataJson,
                skillKey: form.skillKey.trim() || undefined,
                enabled: form.enabled,
            });
            setSelectedId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to save skill";
            alert(message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedSkill) return;
        if (!confirm(`Delete skill ${selectedSkill.name}?`)) return;
        setIsDeleting(true);
        try {
            await deleteSkill({ skillId: selectedSkill._id });
            setSelectedId(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to delete skill";
            alert(message);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="grid gap-6 lg:grid-cols-[2fr,3fr]">
            <div className="bg-white rounded-lg border shadow-sm">
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-900">Skills</h2>
                    <button
                        onClick={() => setSelectedId(null)}
                        className="text-sm text-blue-600 hover:underline"
                    >
                        + New Skill
                    </button>
                </div>
                <div className="max-h-[540px] overflow-y-auto divide-y">
                    {skills?.map((skill: Doc<"skills">) => (
                        <button
                            key={skill._id}
                            onClick={() => setSelectedId(skill._id)}
                            className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedSkill?._id === skill._id ? "bg-blue-50" : ""}`}
                        >
                            <div className="flex justify-between text-sm font-medium text-gray-800">
                                <span>{skill.name}</span>
                                <span className="text-xs uppercase text-gray-500">{skill.type}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] uppercase text-gray-400">
                                <span>{skill.enabled === false ? "disabled" : "enabled"}</span>
                                {skill.skillKey && <span>key: {skill.skillKey}</span>}
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2 mt-1">{skill.content}</p>
                        </button>
                    ))}
                    {(!skills || skills.length === 0) && (
                        <div className="p-4 text-sm text-gray-500">No skills defined yet.</div>
                    )}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                        {selectedSkill ? `Edit ${selectedSkill.name}` : "Create new skill"}
                    </h2>
                    {selectedSkill && (
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
                        <span>Type</span>
                        <input
                            value={form.type}
                            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                            className="w-full border rounded px-3 py-2 text-sm"
                            required
                        />
                    </label>
                    <label className="text-sm text-gray-700 space-y-1">
                        <span>Skill Key</span>
                        <input
                            value={form.skillKey}
                            onChange={(e) => setForm((prev) => ({ ...prev, skillKey: e.target.value }))}
                            className="w-full border rounded px-3 py-2 text-sm"
                        />
                    </label>
                    <label className="text-sm text-gray-700 space-y-1 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={form.enabled}
                            onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                        />
                        <span>Enabled</span>
                    </label>
                </div>

                <label className="text-sm text-gray-700 space-y-1 block">
                    <span>System Prompt</span>
                    <textarea
                        value={form.content}
                        onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm h-40"
                        required
                    />
                </label>

                <label className="text-sm text-gray-700 space-y-1 block">
                    <span>Metadata (JSON)</span>
                    <textarea
                        value={form.metadataJson}
                        onChange={(e) => setForm((prev) => ({ ...prev, metadataJson: e.target.value }))}
                        className="w-full border rounded px-3 py-2 text-sm h-24 font-mono"
                    />
                </label>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-semibold disabled:opacity-50"
                    >
                        {isSaving ? "Saving..." : "Save Skill"}
                    </button>
                </div>
            </form>
        </div>
    );
}
