"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Id } from "../../../../../convex/_generated/dataModel";

type TaskSelectionContextValue = {
    selectedTaskId: Id<"tasks"> | null;
    setSelectedTaskId: (value: Id<"tasks"> | null) => void;
};

const TaskSelectionContext = createContext<TaskSelectionContextValue | null>(null);
const STORAGE_PREFIX = "studioConsole.tasks.selected";

export function TaskSelectionProvider({
    projectId,
    children,
}: {
    projectId: Id<"projects">;
    children: React.ReactNode;
}) {
    const storageKey = `${STORAGE_PREFIX}.${projectId}`;
    const [selectedTaskId, setSelectedTaskIdState] = useState<Id<"tasks"> | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (hydrated) return;
        try {
            const stored = localStorage.getItem(storageKey) as Id<"tasks"> | null;
            if (stored) setSelectedTaskIdState(stored);
        } catch {
            // Ignore storage failures (private mode, tests).
        } finally {
            setHydrated(true);
        }
    }, [hydrated, storageKey]);

    const setSelectedTaskId = useCallback(
        (value: Id<"tasks"> | null) => {
            setSelectedTaskIdState(value);
            if (!hydrated) return;
            try {
                if (value) {
                    localStorage.setItem(storageKey, value);
                } else {
                    localStorage.removeItem(storageKey);
                }
            } catch {
                // Ignore storage failures.
            }
        },
        [hydrated, storageKey],
    );

    const value = useMemo(
        () => ({
            selectedTaskId,
            setSelectedTaskId,
        }),
        [selectedTaskId, setSelectedTaskId],
    );

    return <TaskSelectionContext.Provider value={value}>{children}</TaskSelectionContext.Provider>;
}

export function useTaskSelection(): TaskSelectionContextValue {
    const context = useContext(TaskSelectionContext);
    if (!context) {
        throw new Error("useTaskSelection must be used within a TaskSelectionProvider");
    }
    return context;
}
