"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Id } from "../../../../../convex/_generated/dataModel";

export type ItemTabScope =
    | "ideation"
    | "clarification"
    | "planning"
    | "solutioning"
    | "accounting"
    | "tasks"
    | "quote";

type ItemsContextValue = {
    projectId: Id<"projects">;
    tabScope?: ItemTabScope;
    selectedItemId: Id<"projectItems"> | null;
    setSelectedItemId: (value: Id<"projectItems"> | null) => void;
    selectedItemIds: Id<"projectItems">[];
    toggleItemSelection: (id: Id<"projectItems">) => void;
    selectAllItems: (ids: Id<"projectItems">[]) => void;
    deselectAllItems: () => void;
    selectedAllProject: boolean;
    setSelectedAllProject: (value: boolean) => void;
    selectedItemMode: "approved" | "draft";
    setSelectedItemMode: (value: "approved" | "draft") => void;
    showDraftItems: boolean;
    setShowDraftItems: (value: boolean) => void;
};

const ItemsContext = createContext<ItemsContextValue | null>(null);

const STORAGE_PREFIX = "studioConsole.items.selected";

function resolveTabScope(pathname: string, stageParam?: string): ItemTabScope | undefined {
    if (pathname.includes("/agent")) {
        if (stageParam === "ideation" || stageParam === "planning" || stageParam === "solutioning") {
            return stageParam;
        }
        return "ideation";
    }
    if (pathname.includes("/ideation")) return "ideation";
    if (pathname.includes("/clarification")) return "clarification";
    if (pathname.includes("/planning")) return "planning";
    if (pathname.includes("/solutioning")) return "solutioning";
    if (pathname.includes("/accounting")) return "accounting";
    if (pathname.includes("/tasks")) return "tasks";
    if (pathname.includes("/quote")) return "quote";
    return undefined;
}

export function ItemsProvider({
    projectId,
    children,
}: {
    projectId: Id<"projects">;
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const stageParam = searchParams.get("stage") ?? undefined;
    const tabScope = useMemo(() => resolveTabScope(pathname, stageParam), [pathname, stageParam]);
    const storageKey = `${STORAGE_PREFIX}.${projectId}`;

    const [selectedItemId, setSelectedItemIdState] = useState<Id<"projectItems"> | null>(null);
    const [selectedItemIds, setSelectedItemIds] = useState<Id<"projectItems">[]>([]);
    const [selectedAllProject, setSelectedAllProject] = useState(false);
    const [selectedItemMode, setSelectedItemMode] = useState<"approved" | "draft">("approved");
    const [showDraftItems, setShowDraftItems] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (hydrated) return;
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) setSelectedItemIdState(stored as Id<"projectItems">);
        } catch {
            // Ignore storage failures (private mode, tests).
        } finally {
            setHydrated(true);
        }
    }, [hydrated, storageKey]);

    const setSelectedItemId = useCallback(
        (value: Id<"projectItems"> | null) => {
            setSelectedItemIdState(value);
            // Also add to selection if not present (optional UX choice, keeping simple for now)
            if (value && !selectedItemIds.includes(value)) {
                setSelectedItemIds((prev) => [...prev, value]);
            }
            if (!hydrated) return;
            try {
                if (value) localStorage.setItem(storageKey, value);
                else localStorage.removeItem(storageKey);
            } catch {
                // Ignore storage failures.
            }
        },
        [hydrated, storageKey, selectedItemIds],
    );

    const toggleItemSelection = useCallback((id: Id<"projectItems">) => {
        setSelectedItemIds((prev) => {
            if (prev.includes(id)) {
                return prev.filter((i) => i !== id);
            }
            return [...prev, id];
        });
        setSelectedAllProject(false);
    }, []);

    const selectAllItems = useCallback((ids: Id<"projectItems">[]) => {
        setSelectedItemIds(ids);
        setSelectedAllProject(true); // Or maintain false if we just want to select current list
    }, []);

    const deselectAllItems = useCallback(() => {
        setSelectedItemIds([]);
        setSelectedAllProject(false);
    }, []);

    const value = useMemo(
        () => ({
            projectId,
            tabScope,
            selectedItemId,
            setSelectedItemId,
            selectedItemIds,
            toggleItemSelection,
            selectAllItems,
            deselectAllItems,
            selectedAllProject,
            setSelectedAllProject,
            selectedItemMode,
            setSelectedItemMode,
            showDraftItems,
            setShowDraftItems,
        }),
        [
            projectId,
            tabScope,
            selectedItemId,
            setSelectedItemId,
            selectedItemIds,
            toggleItemSelection,
            selectAllItems,
            deselectAllItems,
            selectedAllProject,
            setSelectedAllProject,
            selectedItemMode,
            showDraftItems,
        ],
    );

    return <ItemsContext.Provider value={value}>{children}</ItemsContext.Provider>;
}

export function useItemsContext(): ItemsContextValue {
    const value = useContext(ItemsContext);
    if (!value) {
        throw new Error("useItemsContext must be used within ItemsProvider");
    }
    return value;
}
