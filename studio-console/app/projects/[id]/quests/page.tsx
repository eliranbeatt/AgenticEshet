"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

export default function QuestsPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const quests = useQuery(api.quests.list, { projectId });
    const stats = useQuery(api.quests.getStats, { projectId });
    const createQuest = useMutation(api.quests.create);
    const deleteQuest = useMutation(api.quests.deleteQuest);
    const updateQuest = useMutation(api.quests.updateQuest);
    const reorderQuests = useMutation(api.quests.reorderQuests);
    
    const [newTitle, setNewTitle] = useState("");

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTitle.trim()) return;
        
        await createQuest({
            projectId,
            title: newTitle,
            order: (quests?.length || 0) + 1,
        });
        setNewTitle("");
    };

    const handleSaveQuest = async (questId: Id<"quests">, title: string, description: string) => {
        await updateQuest({
            questId,
            title: title.trim(),
            description: description.trim() ? description.trim() : undefined,
        });
    };

    const handleReorder = async (questId: Id<"quests">, direction: "up" | "down") => {
        if (!quests) return;
        const currentIndex = quests.findIndex((quest: Doc<"quests">) => quest._id === questId);
        if (currentIndex === -1) return;
        const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= quests.length) return;

        const updatedOrder = [...quests];
        const [moved] = updatedOrder.splice(currentIndex, 1);
        updatedOrder.splice(nextIndex, 0, moved);

        await reorderQuests({
            projectId,
            questIds: updatedOrder.map((quest) => quest._id),
        });
    };

    return (
        <div className="max-w-5xl mx-auto p-4 space-y-8">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Quests & Milestones</h1>
                    <p className="text-gray-500">Group tasks into high-level objectives.</p>
                </div>
                
                <form onSubmit={handleCreate} className="flex gap-2">
                    <input 
                        type="text" 
                        placeholder="New Quest Name..." 
                        className="border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none w-64"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                    />
                    <button className="bg-purple-600 text-white px-4 py-2 rounded font-medium hover:bg-purple-700">
                        Create
                    </button>
                </form>
            </div>

            <div className="grid gap-6">
                {quests?.map((quest: Doc<"quests">, index: number) => {
                    const stat = stats?.find((s: { questId: Id<"quests">; percent: number; done: number; total: number }) => s.questId === quest._id);
                    return (
                        <QuestCard
                            key={quest._id}
                            quest={quest}
                            stat={stat}
                            canMoveUp={index > 0}
                            canMoveDown={!!quests && index < quests.length - 1}
                            onDelete={() => {
                                if (confirm("Delete quest?")) deleteQuest({ questId: quest._id });
                            }}
                            onSave={handleSaveQuest}
                            onReorder={handleReorder}
                        />
                    );
                })}

                {(!quests || quests.length === 0) && (
                    <div className="text-center py-10 text-gray-400 border-2 border-dashed rounded-lg">
                        No quests defined. Create one to organize your workflow!
                    </div>
                )}
            </div>
        </div>
    );
}

function QuestCard({
    quest,
    stat,
    onDelete,
    onSave,
    onReorder,
    canMoveUp,
    canMoveDown,
}: {
    quest: Doc<"quests">;
    stat: { percent: number; done: number; total: number } | undefined;
    onDelete: () => void;
    onSave: (questId: Id<"quests">, title: string, description: string) => Promise<void>;
    onReorder: (questId: Id<"quests">, direction: "up" | "down") => Promise<void>;
    canMoveUp: boolean;
    canMoveDown: boolean;
}) {
    const [title, setTitle] = useState(quest.title);
    const [description, setDescription] = useState(quest.description || "");
    const [isSaving, setIsSaving] = useState(false);
    useEffect(() => {
        setTitle(quest.title);
        setDescription(quest.description || "");
    }, [quest._id, quest.title, quest.description]);
    const dirty = title !== quest.title || (quest.description || "") !== description;

    const handleSave = async () => {
        if (!dirty) return;
        setIsSaving(true);
        try {
            await onSave(quest._id, title, description);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition space-y-4">
            <div className="flex justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px] space-y-2">
                    <input
                        type="text"
                        className="w-full border rounded px-3 py-2 font-semibold text-gray-800 focus:ring-2 focus:ring-purple-500"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    />
                    <textarea
                        className="w-full border rounded px-3 py-2 text-sm text-gray-700 focus:ring-2 focus:ring-purple-500"
                        rows={3}
                        placeholder="Describe the milestone..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
                <div className="flex flex-col gap-2 text-sm text-gray-500">
                    <button
                        type="button"
                        onClick={() => onReorder(quest._id, "up")}
                        disabled={!canMoveUp}
                        className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
                    >
                        ↑ Move Up
                    </button>
                    <button
                        type="button"
                        onClick={() => onReorder(quest._id, "down")}
                        disabled={!canMoveDown}
                        className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
                    >
                        ↓ Move Down
                    </button>
                    <button
                        type="button"
                        onClick={onDelete}
                        className="px-3 py-1 border rounded text-red-600 hover:bg-red-50"
                    >
                        Delete
                    </button>
                </div>
            </div>

            <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>
                        {stat?.percent ?? 0}% ({stat?.done ?? 0}/{stat?.total ?? 0})
                    </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div
                        className="bg-purple-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${stat?.percent ?? 0}%` }}
                    ></div>
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || isSaving}
                    className="px-4 py-2 bg-purple-600 text-white rounded font-medium disabled:opacity-40"
                >
                    {isSaving ? "Saving..." : dirty ? "Save Changes" : "Saved"}
                </button>
            </div>
        </div>
    );
}
