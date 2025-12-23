"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type ModelContextValue = {
    selectedModel: string;
    setSelectedModel: (value: string) => void;
};

const STORAGE_KEY = "studioConsole.selectedModel";
const DEFAULT_MODEL = "gpt-5.2";

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: React.ReactNode }) {
    const [selectedModel, setSelectedModelState] = useState(DEFAULT_MODEL);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) setSelectedModelState(raw);
        } catch {
            // Ignore storage failures
        } finally {
            setHydrated(true);
        }
    }, []);

    const setSelectedModel = useCallback((value: string) => {
        setSelectedModelState(value);
        if (hydrated) {
            try {
                localStorage.setItem(STORAGE_KEY, value);
            } catch {
                // Ignore storage failures
            }
        }
    }, [hydrated]);

    const value = useMemo(
        () => ({
            selectedModel,
            setSelectedModel,
        }),
        [selectedModel, setSelectedModel]
    );

    return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
    const context = useContext(ModelContext);
    if (!context) {
        throw new Error("useModel must be used within a ModelProvider");
    }
    return context;
}
