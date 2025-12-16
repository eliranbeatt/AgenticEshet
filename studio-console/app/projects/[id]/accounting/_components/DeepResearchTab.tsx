"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id, type Doc } from "../../../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ParsedCitation = { title: string; url: string; suffix: string };

function parseCitationsSection(markdown: string): { before: string; citations: ParsedCitation[]; after: string } {
    const headingRegex = /^#{1,6}\s*(citations|sources|מקורות)\s*$/gim;
    const match = headingRegex.exec(markdown);
    if (!match || match.index == null) return { before: markdown, citations: [], after: "" };

    const headingStart = match.index;
    const headingLineEnd = markdown.indexOf("\n", headingStart);
    const contentStart = headingLineEnd === -1 ? markdown.length : headingLineEnd + 1;

    const nextHeadingRegex = /^#{1,6}\s+/gim;
    nextHeadingRegex.lastIndex = contentStart;
    const next = nextHeadingRegex.exec(markdown);
    const contentEnd = next?.index ?? markdown.length;

    const before = markdown.slice(0, headingStart).trimEnd();
    const content = markdown.slice(contentStart, contentEnd);
    const after = markdown.slice(contentEnd).trimStart();

    const lines = content.split(/\r?\n/);
    const citations: ParsedCitation[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const linkMatch = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(line);
        if (linkMatch) {
            const [, title, url] = linkMatch;
            const suffix = line.slice(linkMatch.index + linkMatch[0].length).trim();
            citations.push({ title, url, suffix });
            continue;
        }

        const urlMatch = /(https?:\/\/\S+)/.exec(line);
        if (urlMatch) {
            const url = urlMatch[1].replace(/[),.]+$/, "");
            const title = url;
            const suffix = line.replace(urlMatch[1], "").trim();
            citations.push({ title, url, suffix });
        }
    }

    return { before, citations, after };
}

function rewriteInlineCites(markdown: string, citationUrls: Map<number, string>): string {
    return markdown.replace(/\[cite:\s*([0-9,\s]+)\]/gi, (_full, nums: string) => {
        const parts = nums
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n > 0);

        if (parts.length === 0) return "";

        return parts
            .map((n) => {
                const url = citationUrls.get(n);
                return url ? `[${n}](${url})` : `[${n}]`;
            })
            .join(", ");
    });
}

function normalizeDeepResearchMarkdown(markdown: string): string {
    const { before, citations, after } = parseCitationsSection(markdown);
    if (citations.length === 0) return markdown;

    const citationUrls = new Map<number, string>();
    citations.forEach((c, idx) => {
        citationUrls.set(idx + 1, c.url);
    });

    const rewrittenBody = rewriteInlineCites(before, citationUrls).trimEnd();
    const sources = [
        "## Sources",
        "",
        ...citations.map((c, idx) => {
            const num = idx + 1;
            const suffix = c.suffix ? ` — ${c.suffix.replace(/^[-–—:]\s*/, "")}` : "";
            return `${num}. [${c.title}](${c.url})${suffix}`;
        }),
        "",
    ].join("\n");

    const rewrittenAfter = rewriteInlineCites(after, citationUrls).trimStart();
    return [rewrittenBody, "", sources, rewrittenAfter].filter(Boolean).join("\n");
}

export default function DeepResearchTab({ projectId }: { projectId: Id<"projects"> }) {
    const runs = useQuery(api.deepResearch.listByProject, { projectId }) as
        | Array<Doc<"deepResearchRuns">>
        | undefined;
    const pollRun = useAction(api.agents.deepResearch.pollRun);
    const applyToAccounting = useAction(api.agents.accountingFromDeepResearch.run);
    const [selectedId, setSelectedId] = useState<Id<"deepResearchRuns"> | null>(null);
    const [isPolling, setIsPolling] = useState(false);
    const [isApplying, setIsApplying] = useState(false);

    const selected = useMemo<Doc<"deepResearchRuns"> | null>(() => {
        if (!runs || runs.length === 0) return null;
        if (!selectedId) return runs[0];
        return runs.find((r) => r._id === selectedId) ?? runs[0];
    }, [runs, selectedId]);

    const renderedMarkdown = useMemo(() => {
        return normalizeDeepResearchMarkdown(selected?.reportMarkdown ?? "");
    }, [selected]);

    useEffect(() => {
        if (!selected || selected.status !== "in_progress") return;

        let cancelled = false;
        const interval = setInterval(() => {
            if (cancelled) return;
            setIsPolling(true);
            void pollRun({ runId: selected._id })
                .catch(() => {})
                .finally(() => {
                    if (!cancelled) setIsPolling(false);
                });
        }, 10000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [selected, pollRun]);

    if (runs === undefined) {
        return <div className="p-4 text-sm text-gray-500">Loading deep research...</div>;
    }

    const canApply = Boolean(selected && selected.status === "completed" && (selected.reportMarkdown ?? "").trim());

    const handleApply = async () => {
        if (!selected) return;
        if (!confirm("This will replace current Accounting sections, materials, and labor with items extracted from this Deep-Research report. Continue?")) {
            return;
        }

        setIsApplying(true);
        try {
            await applyToAccounting({ projectId, runId: selected._id, replaceExisting: true });
            alert("Accounting rebuild started in the background. Switch to Summary/Materials/Labor tabs in a moment.");
        } catch (e) {
            alert("Failed to rebuild accounting: " + e);
        } finally {
            setIsApplying(false);
        }
    };

    return (
        <div className="flex gap-4 h-full">
            <div className="w-80 border rounded-lg overflow-hidden bg-white flex flex-col">
                <div className="px-4 py-3 border-b bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-700">Runs</h3>
                    <p className="text-xs text-gray-500">Newest first{isPolling ? " - polling..." : ""}</p>
                </div>
                <div className="flex-1 overflow-auto">
                    {runs.length === 0 ? (
                        <div className="p-4 text-sm text-gray-500">No deep research runs yet.</div>
                    ) : (
                        <div className="divide-y">
                            {runs.map((run) => (
                                <button
                                    key={run._id}
                                    onClick={() => setSelectedId(run._id)}
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                                        selected?._id === run._id ? "bg-blue-50" : ""
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-medium text-gray-800">
                                            {new Date(run.createdAt).toLocaleString()}
                                        </div>
                                        <span
                                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                                run.status === "completed"
                                                    ? "bg-green-100 text-green-800"
                                                    : run.status === "failed"
                                                        ? "bg-red-100 text-red-800"
                                                        : "bg-blue-100 text-blue-800"
                                            }`}
                                        >
                                            {run.status}
                                        </span>
                                    </div>
                                    {run.status === "failed" && run.error && (
                                        <div className="text-xs text-red-700 mt-1 line-clamp-2">{run.error}</div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 border rounded-lg bg-white overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700">Deep-Research Output</h3>
                        <p className="text-xs text-gray-500">Markdown with links and citations</p>
                    </div>
                    <button
                        onClick={handleApply}
                        disabled={!canApply || isApplying}
                        className={`px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                            canApply && !isApplying
                                ? "bg-blue-600 text-white border-blue-600 hover:bg-blue-700"
                                : "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                        }`}
                        title={!canApply ? "Select a completed run to apply" : "Apply this run to Accounting"}
                    >
                        {isApplying ? "Applying..." : "Apply to Accounting"}
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-6 prose prose-sm max-w-none" dir="rtl" lang="he">
                    {!selected ? (
                        <div className="text-sm text-gray-500">Select a run.</div>
                    ) : selected.status === "in_progress" ? (
                        <div className="text-sm text-gray-700">
                            Research is running in the background. This panel updates every ~10s.
                        </div>
                    ) : selected.status === "failed" ? (
                        <div className="text-sm text-red-700 whitespace-pre-wrap">{selected.error ?? "Failed."}</div>
                    ) : (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                a: ({ node, ...props }) => {
                                    void node;
                                    return <a {...props} target="_blank" rel="noreferrer" />;
                                },
                            }}
                        >
                            {renderedMarkdown || "(empty)"}
                        </ReactMarkdown>
                    )}
                </div>
            </div>
        </div>
    );
}
