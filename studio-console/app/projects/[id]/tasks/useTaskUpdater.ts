"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { StudioPhase } from "@/convex/constants";

type UpdateTaskArgs = {
    taskId: Id<"tasks">;
    title?: string;
    description?: string;
    status?: "todo" | "in_progress" | "blocked" | "done";
    category?: "Logistics" | "Creative" | "Finance" | "Admin" | "Studio";
    priority?: "High" | "Medium" | "Low";
    questId?: Id<"quests">;
    accountingSectionId?: Id<"sections">;
    accountingLineType?: "material" | "work";
    accountingLineId?: Id<"materialLines"> | Id<"workLines">;
    itemId?: Id<"projectItems">;
    itemSubtaskId?: string;
    workstream?: string;
    isManagement?: boolean;
    startDate?: number;
    endDate?: number;
    dependencies?: Id<"tasks">[];
    estimatedMinutes?: number | null;
    steps?: string[];
    subtasks?: Array<{ title: string; done: boolean }>;
    assignee?: string | null;
    studioPhase?: StudioPhase;
};

export function useTaskUpdater() {
    const updateTask = useMutation(api.tasks.updateTask);

    const updateTaskShared = useCallback(
        async (input: UpdateTaskArgs) => {
            await updateTask(input);
        },
        [updateTask]
    );

    return { updateTaskShared };
}
