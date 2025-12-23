"use client";

import { useModel } from "./ModelContext";

export default function ModelSelector() {
    const { selectedModel, setSelectedModel } = useModel();

    return (
        <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold">Model</span>
            <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
                <option value="gpt-5.2">GPT-5.2</option>
                <option value="gpt-5-mini">GPT-5 Mini</option>
                <option value="gpt-5-nano">GPT-5 Nano</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
        </div>
    );
}
