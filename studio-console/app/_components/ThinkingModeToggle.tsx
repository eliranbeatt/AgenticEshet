"use client";

import { useThinkingMode } from "../_context/ThinkingModeContext";

export default function ThinkingModeToggle() {
    const { thinkingMode, setThinkingMode } = useThinkingMode();

    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
                <span className="text-xs font-semibold">Thinking</span>
                <span className="text-[11px] text-muted-foreground">
                    {thinkingMode ? "On (slower, deeper)" : "Off (fast)"}
                </span>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={thinkingMode}
                onClick={() => setThinkingMode(!thinkingMode)}
                className={[
                    "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                    thinkingMode
                        ? "bg-blue-600 border-blue-600"
                        : "bg-muted border-border",
                ].join(" ")}
            >
                <span
                    className={[
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                        thinkingMode ? "translate-x-5" : "translate-x-1",
                    ].join(" ")}
                />
            </button>
        </div>
    );
}

