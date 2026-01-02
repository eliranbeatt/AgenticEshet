"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function CurrentKnowledgePanel({ projectId }: { projectId: Id<"projects"> }) {
    const brain = useQuery(api.projectBrain.getCurrent, { projectId });

    const summary = useMemo(() => {
        if (!brain) return "(no brain yet)";
        const lines: string[] = [];
        lines.push("# Project Brain");
        lines.push("");
        lines.push("## Overview");
        (brain.project?.overview ?? []).forEach((b: any) => lines.push(`- ${b.text}`));
        lines.push("");
        lines.push("## Preferences");
        (brain.project?.preferences ?? []).forEach((b: any) => lines.push(`- ${b.text}`));
        lines.push("");
        lines.push("## Constraints");
        (brain.project?.constraints ?? []).forEach((b: any) => lines.push(`- ${b.text}`));
        lines.push("");
        lines.push("## Timeline");
        (brain.project?.timeline ?? []).forEach((b: any) => lines.push(`- ${b.text}`));
        lines.push("");
        lines.push("## Stakeholders");
        (brain.project?.stakeholders ?? []).forEach((b: any) => lines.push(`- ${b.text}`));
        return lines.join("\n");
    }, [brain]);

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                <div className="flex flex-col">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-700">Project Brain</div>
                    <div className="text-[10px] text-gray-500">Structured memory (read-only here)</div>
                </div>
            </div>
            <div className="flex-1 p-0 relative">
                <pre className="w-full h-full p-4 text-sm leading-relaxed font-mono text-gray-800 whitespace-pre-wrap">
                    {summary}
                </pre>
            </div>
            <div className="bg-gray-50 border-t px-4 py-2 text-[10px] text-gray-400 text-center">
                Project Brain updates on submit/send/upload events.
            </div>
        </div>
    );
}
