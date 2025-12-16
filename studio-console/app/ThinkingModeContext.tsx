"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThinkingModeContextValue = {
    thinkingMode: boolean;
    setThinkingMode: (value: boolean) => void;
    toggleThinkingMode: () => void;
};

const STORAGE_KEY = "studioConsole.thinkingMode";

const ThinkingModeContext = createContext<ThinkingModeContextValue | null>(null);

export function ThinkingModeProvider({ children }: { children: React.ReactNode }) {
    const [thinkingMode, setThinkingModeState] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw === "true") setThinkingModeState(true);
            if (raw === "false") setThinkingModeState(false);
        } finally {
            setHydrated(true);
        }
    }, []);

    const setThinkingMode = (value: boolean) => {
        setThinkingModeState(value);
        if (hydrated) {
            try {
                localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
            } catch {
                // Ignore storage failures (e.g., private browsing).
            }
        }
    };

    const toggleThinkingMode = () => setThinkingMode(!thinkingMode);

    const value = useMemo(
        () => ({
            thinkingMode,
            setThinkingMode,
            toggleThinkingMode,
        }),
        [thinkingMode, hydrated]
    );

    return (
        <ThinkingModeContext.Provider value={value}>
            {children}
        </ThinkingModeContext.Provider>
    );
}

export function useThinkingMode(): ThinkingModeContextValue {
    const value = useContext(ThinkingModeContext);
    if (!value) {
        throw new Error("useThinkingMode must be used within ThinkingModeProvider");
    }
    return value;
}

