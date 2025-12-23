"use client";

import React, { useState, useMemo, useCallback } from "react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";

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

    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

    const ganttTasks: Task[] = useMemo(() => {
        if (!tasks) return [];
        const itemMap = new Map<string, string>();
        for (const item of itemsData?.items ?? []) {
            itemMap.set(item._id, item.title);
        }
        
        return tasks.map((t) => {
            // Default to today if no start date, or keep existing
            const start = t.startDate ? new Date(t.startDate) : startOfDay(new Date());
            
            let end: Date;
            if (t.endDate) {
                end = new Date(t.endDate);
            } else if (t.estimatedDuration) {
                end = new Date(start.getTime() + t.estimatedDuration);
            } else {
                end = addDays(start, 1);
            }
            
            return {
                start,
                end,
                name: t.itemId && itemMap.has(t.itemId) ? `[${itemMap.get(t.itemId)}] ${t.title}` : t.title,
                id: t._id,
                type: "task",
                progress: t.status === "done" ? 100 : t.status === "in_progress" ? 50 : 0,
                isDisabled: false,
                styles: { progressColor: "#ffbb54", progressSelectedColor: "#ff9e0d" },
                dependencies: ((t.dependencies as Array<Id<"tasks">> | undefined) ?? []).map((d) => String(d)),
            };
        });
    }, [itemsData?.items, tasks]);

    const handleTaskChange = useCallback(
        async (task: Task) => {
            const newStart = task.start.getTime();
            const newEnd = task.end.getTime();
            
            // 1. Update the moved task
            await updateTask({
                taskId: task.id as Id<"tasks">,
                startDate: newStart,
                endDate: newEnd,
            });

            // 2. Simple cascade for direct dependencies
            // Find tasks that depend on this one
            const children = tasks?.filter(t => t.dependencies?.includes(task.id as Id<"tasks">));
            
            if (children) {
                for (const child of children) {
                    const childStart = child.startDate ?? newStart;
                    const childEnd = child.endDate ?? (childStart + 86400000);
                    
                    // If child starts before parent ends, push it
                    if (childStart < newEnd) {
                        const duration = childEnd - childStart;
                        const newChildStart = newEnd;
                        const newChildEnd = newChildStart + duration;
                        
                        await updateTask({
                            taskId: child._id,
                            startDate: newChildStart,
                            endDate: newChildEnd,
                        });
                        // Note: This only handles one level of depth. 
                        // For deep chains, a recursive function or server-side logic is better.
                    }
                }
            }
        },
        [tasks, updateTask]
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
                <Gantt
                    tasks={ganttTasks}
                    viewMode={viewMode}
                    onDateChange={handleTaskChange}
                    listCellWidth="155px"
                    columnWidth={viewMode === ViewMode.Month ? 300 : 65}
                    barFill={60}
                />
            </div>
        </div>
    );
}
