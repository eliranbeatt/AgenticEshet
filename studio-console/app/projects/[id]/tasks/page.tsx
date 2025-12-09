"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

type UpdateTaskInput = {
    taskId: Id<"tasks">;
    title?: string;
    description?: string;
    status?: Doc<"tasks">["status"];
    category?: Doc<"tasks">["category"];
    priority?: Doc<"tasks">["priority"];
    questId?: Id<"quests">;
};

type DeleteTaskInput = {
    taskId: Id<"tasks">;
};

export default function TasksPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const tasks = useQuery(api.tasks.listByProject, { projectId });
    const runArchitect = useAction(api.agents.architect.run);
    const updateTask = useMutation(api.tasks.updateTask);
    const createTask = useMutation(api.tasks.createTask);
    const deleteTask = useMutation(api.tasks.deleteTask);

    const [isGenerating, setIsGenerating] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState("");

    const handleAutoGenerate = async () => {
        setIsGenerating(true);
        try {
            await runArchitect({ projectId });
            // Tasks update automatically via subscription
        } catch (err) {
            console.error(err);
            alert("Failed to generate tasks. Make sure a plan exists.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCreateManual = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;
        
        await createTask({
            projectId,
            title: newTaskTitle,
            status: "todo",
            category: "Studio", // Default
            priority: "Medium",
        });
        setNewTaskTitle("");
    };

    // Columns configuration
    const columns = [
        { id: "todo", title: "To Do", color: "bg-gray-100" },
        { id: "in_progress", title: "In Progress", color: "bg-blue-50" },
        { id: "blocked", title: "Blocked", color: "bg-red-50" },
        { id: "done", title: "Done", color: "bg-green-50" },
    ];

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)]">
            {/* Header / Actions */}
            <div className="flex justify-between items-center mb-6">
                <form onSubmit={handleCreateManual} className="flex gap-2 w-1/3">
                    <input 
                        type="text" 
                        placeholder="Add quick task..." 
                        className="flex-1 border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                    />
                    <button type="submit" className="bg-white border hover:bg-gray-50 text-gray-700 px-3 py-2 rounded text-sm font-medium">Add</button>
                </form>

                <button 
                    onClick={handleAutoGenerate}
                    disabled={isGenerating}
                    className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                >
                    {isGenerating ? "Thinking..." : "Auto-Generate from Plan"}
                </button>
            </div>

            {/* Board */}
            <div className="flex-1 overflow-x-auto">
                <div className="flex gap-4 h-full min-w-max">
                    {columns.map((col) => (
                        <div key={col.id} className={`w-80 flex flex-col rounded-lg ${col.color} p-4`}>
                            <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs flex justify-between">
                                {col.title}
                                <span className="bg-white px-2 rounded-full text-gray-500">
                                    {tasks?.filter(t => t.status === col.id).length || 0}
                                </span>
                            </h3>
                            
                            <div className="flex-1 overflow-y-auto space-y-3">
                                {tasks?.filter(t => t.status === col.id).map(task => (
                                    <TaskCard 
                                        key={task._id} 
                                        task={task} 
                                        onUpdate={updateTask}
                                        onDelete={deleteTask}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function TaskCard({
    task,
    onUpdate,
    onDelete,
}: {
    task: Doc<"tasks">;
    onUpdate: (input: UpdateTaskInput) => Promise<void>;
    onDelete: (input: DeleteTaskInput) => Promise<void>;
}) {
    return (
        <div className="bg-white p-3 rounded shadow-sm border hover:shadow-md transition group relative">
            <div className="flex justify-between items-start mb-2">
                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
                    task.category === "Creative" ? "bg-pink-50 text-pink-700 border-pink-200" :
                    task.category === "Logistics" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                    "bg-gray-50 text-gray-600 border-gray-200"
                }`}>
                    {task.category}
                </span>
                {task.priority === "High" && <span className="text-[10px] text-red-600 font-bold">!!!</span>}
            </div>
            
            <p className="text-sm font-medium text-gray-800 mb-1">{task.title}</p>
            {task.description && <p className="text-xs text-gray-500 line-clamp-2 mb-2">{task.description}</p>}
            
            {/* Simple status controls (since no DnD) */}
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
                <select 
                    className="text-xs bg-transparent text-gray-500 outline-none cursor-pointer hover:text-blue-600"
                    value={task.status}
                    onChange={(e) => onUpdate({ taskId: task._id, status: e.target.value })}
                >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                </select>
                
                <button 
                    onClick={() => { if(confirm("Delete task?")) onDelete({ taskId: task._id }); }}
                    className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                >
                    Delete
                </button>
            </div>
        </div>
    );
}
