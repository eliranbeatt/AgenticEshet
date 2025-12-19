"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { AgentChatThread } from "../../_components/chat/AgentChatThread";
import { ImageGeneratorPanel } from "../../_components/images/ImageGeneratorPanel";
import { ImagePicker } from "../../_components/images/ImagePicker";

const statusOptions: Array<Doc<"tasks">["status"]> = ["todo", "in_progress", "blocked", "done"];
const categoryOptions: Array<Doc<"tasks">["category"]> = ["Logistics", "Creative", "Finance", "Admin", "Studio"];
const priorityOptions: Array<Doc<"tasks">["priority"]> = ["High", "Medium", "Low"];

export function TaskModal({
    projectId,
    task,
    onClose,
}: {
    projectId: Id<"projects">;
    task: Doc<"tasks">;
    onClose: () => void;
}) {
    const ensureThread = useMutation(api.chat.ensureThread);
    const updateTask = useMutation(api.tasks.updateTask);
    const sendAiPatch = useAction(api.agents.taskEditor.send);

    const [threadId, setThreadId] = useState<Id<"chatThreads"> | null>(null);

    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description ?? "");
    const [status, setStatus] = useState<Doc<"tasks">["status"]>(task.status);
    const [category, setCategory] = useState<Doc<"tasks">["category"]>(task.category);
    const [priority, setPriority] = useState<Doc<"tasks">["priority"]>(task.priority);
    const [estimatedMinutes, setEstimatedMinutes] = useState<string>(
        task.estimatedMinutes === null || task.estimatedMinutes === undefined ? "" : String(task.estimatedMinutes)
    );
    const [assignee, setAssignee] = useState<string>(task.assignee ?? "");

    const [stepsText, setStepsText] = useState<string>((task.steps ?? []).join("\n"));
    const [subtasks, setSubtasks] = useState<Array<{ title: string; done: boolean }>>(task.subtasks ?? []);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

    useEffect(() => {
        void (async () => {
            const result = await ensureThread({
                projectId,
                phase: "tasks",
                scenarioKey: `task:${task._id}`,
                title: `Task: ${task.title}`,
            });
            setThreadId(result.threadId);
        })();
    }, [ensureThread, projectId, task._id, task.title]);

    const hasChanges = useMemo(() => {
        const steps = stepsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
        const est = estimatedMinutes.trim() ? Number(estimatedMinutes) : null;

        return (
            title !== task.title ||
            description !== (task.description ?? "") ||
            status !== task.status ||
            category !== task.category ||
            priority !== task.priority ||
            (task.estimatedMinutes ?? null) !== (Number.isFinite(est) ? est : null) ||
            (task.assignee ?? "") !== assignee ||
            JSON.stringify(task.steps ?? []) !== JSON.stringify(steps) ||
            JSON.stringify(task.subtasks ?? []) !== JSON.stringify(subtasks)
        );
    }, [assignee, category, description, estimatedMinutes, priority, status, stepsText, subtasks, task, title]);

    async function save() {
        const steps = stepsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);

        const estimated =
            estimatedMinutes.trim().length === 0 ? null : Number.isFinite(Number(estimatedMinutes)) ? Number(estimatedMinutes) : null;

        await updateTask({
            taskId: task._id,
            title: title.trim() || task.title,
            description: description.trim() ? description : undefined,
            status,
            category,
            priority,
            estimatedMinutes: estimated,
            steps,
            subtasks,
            assignee: assignee.trim() ? assignee.trim() : null,
        });
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Close modal"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-lg shadow-xl w-[min(1100px,95vw)] max-h-[92vh] overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b">
                    <div>
                        <div className="text-xs text-gray-500">Task #{task.taskNumber ?? "?"}</div>
                        <div className="text-lg font-semibold text-gray-900">Edit task</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="text-sm px-3 py-1 rounded border bg-white hover:bg-gray-50"
                            onClick={onClose}
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            className="text-sm px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            disabled={!hasChanges}
                            onClick={async () => {
                                await save();
                                onClose();
                            }}
                        >
                            Save
                        </button>
                    </div>
                </div>

                <div className="grid lg:grid-cols-[1fr,420px] gap-0">
                    <div className="p-4 overflow-y-auto max-h-[calc(92vh-64px)] space-y-4">
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className="md:col-span-2">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Title
                                </label>
                                <input
                                    className="w-full border rounded px-3 py-2 text-sm"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                />
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Status
                                </label>
                                <select
                                    className="w-full border rounded px-3 py-2 text-sm bg-white"
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as Doc<"tasks">["status"])}
                                >
                                    {statusOptions.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Category
                                </label>
                                <select
                                    className="w-full border rounded px-3 py-2 text-sm bg-white"
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value as Doc<"tasks">["category"])}
                                >
                                    {categoryOptions.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Priority
                                </label>
                                <select
                                    className="w-full border rounded px-3 py-2 text-sm bg-white"
                                    value={priority}
                                    onChange={(e) => setPriority(e.target.value as Doc<"tasks">["priority"])}
                                >
                                    {priorityOptions.map((p) => (
                                        <option key={p} value={p}>
                                            {p}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Estimated minutes
                                </label>
                                <input
                                    className="w-full border rounded px-3 py-2 text-sm"
                                    inputMode="numeric"
                                    value={estimatedMinutes}
                                    onChange={(e) => setEstimatedMinutes(e.target.value)}
                                    placeholder="e.g. 90"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Assignee
                                </label>
                                <input
                                    className="w-full border rounded px-3 py-2 text-sm"
                                    value={assignee}
                                    onChange={(e) => setAssignee(e.target.value)}
                                    placeholder="Name"
                                />
                            </div>

                            <div className="md:col-span-2">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Description
                                </label>
                                <textarea
                                    className="w-full border rounded px-3 py-2 text-sm resize-none min-h-[120px]"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Steps</label>
                            <textarea
                                className="w-full border rounded px-3 py-2 text-sm font-mono resize-none min-h-[120px]"
                                value={stepsText}
                                onChange={(e) => setStepsText(e.target.value)}
                                placeholder={"One step per line\n1) ...\n2) ..."}
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                                    Subtasks
                                </label>
                                <button
                                    type="button"
                                    className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50 disabled:opacity-50"
                                    disabled={!newSubtaskTitle.trim()}
                                    onClick={() => {
                                        const title = newSubtaskTitle.trim();
                                        if (!title) return;
                                        setSubtasks([...subtasks, { title, done: false }]);
                                        setNewSubtaskTitle("");
                                    }}
                                >
                                    Add
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    className="flex-1 border rounded px-3 py-2 text-sm"
                                    value={newSubtaskTitle}
                                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                                    placeholder="New subtask title"
                                />
                            </div>
                            {subtasks.length === 0 ? (
                                <div className="text-sm text-gray-500">No subtasks yet.</div>
                            ) : (
                                <div className="space-y-2">
                                    {subtasks.map((st, idx) => (
                                        <div key={`${idx}:${st.title}`} className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={st.done}
                                                onChange={(e) => {
                                                    const next = [...subtasks];
                                                    next[idx] = { ...st, done: e.target.checked };
                                                    setSubtasks(next);
                                                }}
                                            />
                                            <input
                                                className="flex-1 border rounded px-3 py-2 text-sm"
                                                value={st.title}
                                                onChange={(e) => {
                                                    const next = [...subtasks];
                                                    next[idx] = { ...st, title: e.target.value };
                                                    setSubtasks(next);
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="text-xs text-red-600 hover:text-red-800"
                                                onClick={() => setSubtasks(subtasks.filter((_, i) => i !== idx))}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <ImageGeneratorPanel
                            projectId={projectId}
                            entityType="task"
                            entityId={String(task._id)}
                            defaultPrompt={`${task.title} - reference image`}
                        />
                        <ImagePicker projectId={projectId} entityType="task" entityId={String(task._id)} />
                    </div>

                    <div className="border-l bg-gray-50 p-4 overflow-y-auto max-h-[calc(92vh-64px)] space-y-3">
                        <div className="bg-white border rounded p-3">
                            <div className="text-sm font-semibold text-gray-800">AI patch chat</div>
                            <div className="text-xs text-gray-500 mt-1">
                                Describe the change you want. The assistant will apply a patch to this task.
                            </div>
                        </div>

                        {threadId ? (
                            <AgentChatThread
                                threadId={threadId}
                                heightClassName="h-[520px]"
                                placeholder="e.g. Break into 5 steps, add subtasks, set priority to High..."
                                onSend={async (content) => {
                                    await sendAiPatch({ threadId, taskId: task._id, userContent: content });
                                }}
                            />
                        ) : (
                            <div className="text-sm text-gray-500">Initializing AI chat...</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
