"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { useTaskSelection } from "../../_components/tasks/TaskSelectionContext";

function startOfDay(date: Date): Date {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

function addDays(date: Date, amount: number): Date {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + amount);
    return shifted;
}

export default function GanttView() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const tasks = useQuery(api.tasks.listByProject, { projectId }) as Array<Doc<"tasks">> | undefined;
    const itemsData = useQuery(api.items.listSidebarTree, { projectId, includeDrafts: true });
    const updateTask = useMutation(api.tasks.updateTask);
    const { selectedTaskId, setSelectedTaskId } = useTaskSelection();

    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

    const taskDependencies = useMemo(() => {
        if (!tasks) return new Map<string, Doc<"tasks">>();
        const map = new Map<string, Doc<"tasks">>();
        tasks.forEach((task) => map.set(String(task._id), task));
        return map;
    }, [tasks]);

    const ganttTasks: Task[] = useMemo(() => {
        if (!tasks) return [];
        const itemMap = new Map<string, string>();
        for (const item of itemsData?.items ?? []) {
            itemMap.set(item._id, item.title);
        }

        const getDurationMs = (task: Doc<"tasks">) => {
            if (task.estimatedDuration && Number.isFinite(task.estimatedDuration)) return task.estimatedDuration;
            if (typeof task.durationHours === "number" && Number.isFinite(task.durationHours)) return task.durationHours * 60 * 60 * 1000;
            if (typeof task.estimatedMinutes === "number" && Number.isFinite(task.estimatedMinutes)) return task.estimatedMinutes * 60 * 1000;
            return 24 * 60 * 60 * 1000;
        };

        const deriveStart = (task: Doc<"tasks">): Date => {
            const direct = task.startDate ?? task.plannedStart;
            if (direct) return startOfDay(new Date(direct));

            const dependencyDates = (task.dependencies ?? [])
                .map((id) => taskDependencies.get(String(id)))
                .map((dep) => {
                    if (!dep) return null;
                    const dependencyStartSource = dep.startDate ?? dep.plannedStart;
                    const dependencyStart = dependencyStartSource ? startOfDay(new Date(dependencyStartSource)) : startOfDay(new Date());
                    if (dep.endDate ?? dep.plannedEnd) {
                        return new Date((dep.endDate ?? dep.plannedEnd) as number | string);
                    }
                    return new Date(dependencyStart.getTime() + getDurationMs(dep));
                })
                .filter((value): value is Date => Boolean(value));

            if (dependencyDates.length > 0) {
                const latest = dependencyDates.reduce((max, date) => (date.getTime() > max.getTime() ? date : max), dependencyDates[0]);
                return startOfDay(latest);
            }

            return startOfDay(new Date());
        };

        const deriveEnd = (task: Doc<"tasks">, start: Date): Date => {
            const planned = task.endDate ?? task.plannedEnd;
            if (planned) {
                const plannedEnd = new Date(planned);
                if (plannedEnd.getTime() >= start.getTime()) return plannedEnd;
            }

            return new Date(start.getTime() + getDurationMs(task));
        };

        return tasks.map((t) => {
            const start = deriveStart(t);
            const end = deriveEnd(t, start);

            return {
                start,
                end,
                name: t.itemId && itemMap.has(t.itemId) ? `[${itemMap.get(t.itemId)}] ${t.title}` : t.title,
                id: t._id,
                type: "task",
                progress: t.status === "done" ? 100 : t.status === "in_progress" ? 50 : 0,
                isDisabled: false,
                styles: {
                    backgroundColor: selectedTaskId === t._id ? "#e0edff" : undefined,
                    backgroundSelectedColor: "#d0e0ff",
                    progressColor: selectedTaskId === t._id ? "#2563eb" : "#ffbb54",
                    progressSelectedColor: "#1d4ed8",
                },
                dependencies: ((t.dependencies as Array<Id<"tasks">> | undefined) ?? []).map((d) => String(d)),
            };
        });
    }, [itemsData?.items, selectedTaskId, taskDependencies, tasks]);

    const handleTaskChange = useCallback(
        async (task: Task) => {
            const newStart = task.start.getTime();
            const newEnd = task.end.getTime();
            const duration = Math.max(newEnd - newStart, 60 * 60 * 1000);

            await updateTask({
                taskId: task.id as Id<"tasks">,
                startDate: newStart,
                endDate: newEnd,
                estimatedDuration: duration,
            });

            const children = tasks?.filter((t) => t.dependencies?.includes(task.id as Id<"tasks">));
            if (children) {
                for (const child of children) {
                    const childStart = child.startDate ?? newStart;
                    const childEnd = child.endDate ?? childStart + (child.estimatedDuration ?? 24 * 60 * 60 * 1000);

                    if (childStart < newEnd) {
                        const cascadeDuration = Math.max(childEnd - childStart, 60 * 60 * 1000);
                        const newChildStart = newEnd;
                        const newChildEnd = newChildStart + cascadeDuration;

                        await updateTask({
                            taskId: child._id,
                            startDate: newChildStart,
                            endDate: newChildEnd,
                            estimatedDuration: cascadeDuration,
                        });
                    }
                }
            }
        },
        [tasks, updateTask],
    );

    if (!tasks) return <div className="p-8">Loading tasks...</div>;
    if (tasks.length === 0) return <div className="p-8">No tasks found. Create some tasks in the Tasks tab to see the Gantt chart.</div>;

    return (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b flex gap-2 bg-white">
                <button 
                    onClick={() => setViewMode(ViewMode.Day)} 
                    className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Day ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                    Day
                </button>
                <button 
                    onClick={() => setViewMode(ViewMode.Week)} 
                    className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Week ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                    Week
                </button>
                <button 
                    onClick={() => setViewMode(ViewMode.Month)} 
                    className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Month ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                    Month
                </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
                <style>{`
                    /* Hide text inside the Gantt bars */
                    .gantt .barLabel {
                        display: none !important;
                    }
                `}</style>
                <Gantt
                    tasks={ganttTasks}
                    viewMode={viewMode}
                    onDateChange={handleTaskChange}
                    onSelect={(task) => setSelectedTaskId((task?.id as Id<"tasks">) ?? null)}
                    selectedTask={ganttTasks.find((task) => task.id === selectedTaskId)}
                    listCellWidth="155px"
                    columnWidth={viewMode === ViewMode.Month ? 300 : viewMode === ViewMode.Week ? 120 : 65}
                    barFill={60}
                />
            </div>
        </div>
    );
}
