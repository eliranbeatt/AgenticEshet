"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export default function QuestsPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    
    const quests = useQuery(api.quests.list, { projectId });
    const stats = useQuery(api.quests.getStats, { projectId });
    const createQuest = useMutation(api.quests.create);
    const deleteQuest = useMutation(api.quests.deleteQuest);
    
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

    return (
        <div className="max-w-4xl mx-auto p-4">
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
                {quests?.map((quest) => {
                    const stat = stats?.find(s => s.questId === quest._id);
                    return (
                        <div key={quest._id} className="bg-white p-6 rounded-lg shadow-sm border hover:shadow-md transition">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800">{quest.title}</h3>
                                    {quest.description && <p className="text-gray-500 text-sm">{quest.description}</p>}
                                </div>
                                <button 
                                    onClick={() => { if(confirm("Delete quest?")) deleteQuest({ questId: quest._id }) }}
                                    className="text-gray-300 hover:text-red-500"
                                >
                                    &times;
                                </button>
                            </div>

                            {/* Progress Bar */}
                            <div className="mb-4">
                                <div className="flex justify-between text-xs text-gray-500 mb-1">
                                    <span>Progress</span>
                                    <span>{stat?.percent || 0}% ({stat?.done || 0}/{stat?.total || 0})</span>
                                </div>
                                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                                    <div 
                                        className="bg-purple-600 h-2.5 rounded-full transition-all duration-500" 
                                        style={{ width: `${stat?.percent || 0}%` }}
                                    ></div>
                                </div>
                            </div>
                            
                            {/* In a full app, we'd list tasks here or drag-and-drop tasks into quests */}
                            <div className="text-xs text-gray-400 bg-gray-50 p-2 rounded text-center border border-dashed">
                                To assign tasks to this quest, verify &quot;questId&quot; field in Tasks (Implementation pending drag-drop UI)
                            </div>
                        </div>
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
