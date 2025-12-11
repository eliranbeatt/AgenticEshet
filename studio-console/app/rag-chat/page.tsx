"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

type SourceType = "doc_upload" | "plan" | "conversation" | "task" | "quest" | "quote" | "system_note";

type RetrievedDoc = {
    label: string;
    docId: Id<"knowledgeDocs">;
    title: string;
    sourceType: SourceType;
    scope: "project" | "global";
    summary?: string;
    text?: string;
    topics: string[];
    domain?: string | null;
    clientName?: string | null;
};

type ChatTurn = {
    question: string;
    answer: string;
    citations: RetrievedDoc[];
};

export default function RagChatPage() {
    const dynamicSearch = useAction(api.knowledge.dynamicSearch);

    const [question, setQuestion] = useState("");
    const [projectId, setProjectId] = useState("");
    const [scope, setScope] = useState<"project" | "global" | "both">("both");
    const [limit, setLimit] = useState(6);
    const [minScore, setMinScore] = useState(0);
    const [loading, setLoading] = useState(false);
    const [chat, setChat] = useState<ChatTurn[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleAsk = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!question.trim()) return;
        setLoading(true);
        setError(null);

        try {
            const results = await dynamicSearch({
                projectId: projectId.trim() ? (projectId.trim() as Id<"projects">) : undefined,
                query: question,
                scope,
                limit,
                minScore,
                includeSummaries: true,
                returnChunks: true,
                agentRole: "rag_chat",
                sourceTypes: ["plan", "conversation", "task", "quest", "quote", "doc_upload", "system_note"],
            });

            const citations: RetrievedDoc[] = (results as any[]).map((entry, idx) => ({
                label: `[${idx + 1}]`,
                docId: entry.doc._id,
                title: entry.doc.title,
                sourceType: entry.doc.sourceType,
                scope: entry.scope,
                summary: entry.doc.summary,
                text: entry.text,
                topics: entry.doc.topics ?? [],
                domain: entry.doc.domain,
                clientName: entry.doc.clientName,
            }));

            const topSnippets = citations
                .slice(0, 3)
                .map((c) => `${c.label} ${c.title}: ${c.summary || c.text || "No preview"}`);

            const answer = topSnippets.length
                ? `Based on retrieved context:\n${topSnippets.join("\n")}`
                : "No relevant knowledge found.";

            setChat((prev) => [...prev, { question, answer, citations }]);
            setQuestion("");
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to run RAG search";
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <header className="space-y-2">
                <h1 className="text-2xl font-bold text-gray-900">RAG Chat</h1>
                <p className="text-sm text-gray-600">
                    Ask a question and see retrieved knowledge with inline citations. Use project scope, global, or both.
                </p>
            </header>

            <form onSubmit={handleAsk} className="bg-white border rounded shadow p-4 space-y-4">
                <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                        Question
                        <textarea
                            className="w-full border rounded p-3 mt-1 focus:ring-2 focus:ring-blue-500 outline-none"
                            rows={3}
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            placeholder="e.g., Summarize recent planning notes and tasks for Client X"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs uppercase text-gray-500 font-semibold">Project ID (optional)</span>
                        <input
                            type="text"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="border rounded px-2 py-2"
                            placeholder="proj_123..."
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs uppercase text-gray-500 font-semibold">Scope</span>
                        <select
                            value={scope}
                            onChange={(e) => setScope(e.target.value as "project" | "global" | "both")}
                            className="border rounded px-2 py-2"
                        >
                            <option value="project">Project only</option>
                            <option value="global">Global</option>
                            <option value="both">Project + global</option>
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs uppercase text-gray-500 font-semibold">Limit</span>
                        <input
                            type="number"
                            min={1}
                            max={20}
                            value={limit}
                            onChange={(e) => setLimit(Number(e.target.value) || 6)}
                            className="border rounded px-2 py-2"
                        />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs uppercase text-gray-500 font-semibold">Min score</span>
                        <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={minScore}
                            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                            className="border rounded px-2 py-2"
                        />
                    </label>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 text-white px-6 py-2 rounded font-semibold disabled:opacity-50"
                >
                    {loading ? "Retrieving..." : "Ask with RAG"}
                </button>
            </form>

            <div className="space-y-4">
                {chat.map((turn, idx) => (
                    <div key={idx} className="bg-white border rounded shadow p-4 space-y-3">
                        <div>
                            <p className="text-xs uppercase text-gray-500 font-semibold">You</p>
                            <p className="text-sm text-gray-900 whitespace-pre-line">{turn.question}</p>
                        </div>
                        <div>
                            <p className="text-xs uppercase text-gray-500 font-semibold">Answer</p>
                            <p className="text-sm text-gray-900 whitespace-pre-line">{turn.answer}</p>
                        </div>
                        {turn.citations.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs uppercase text-gray-500 font-semibold">Citations</p>
                                <div className="space-y-2">
                                    {turn.citations.map((c) => (
                                        <div key={c.docId} className="border rounded p-2 bg-gray-50">
                                            <div className="flex items-center gap-2 text-xs text-gray-700 flex-wrap">
                                                <span className="font-semibold">{c.label}</span>
                                                <span className="uppercase bg-gray-200 text-gray-800 px-2 py-0.5 rounded">
                                                    {c.sourceType}
                                                </span>
                                                <span className="uppercase bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                                                    {c.scope}
                                                </span>
                                                {c.domain && (
                                                    <span className="uppercase bg-gray-200 text-gray-800 px-2 py-0.5 rounded">
                                                        {c.domain}
                                                    </span>
                                                )}
                                                {c.clientName && (
                                                    <span className="uppercase bg-gray-200 text-gray-800 px-2 py-0.5 rounded">
                                                        {c.clientName}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-sm font-semibold text-gray-900 mt-1">{c.title}</p>
                                            <p className="text-xs text-gray-700 whitespace-pre-line">
                                                {c.summary || c.text || "No preview available."}
                                            </p>
                                            {c.topics?.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1 text-[11px] text-gray-600">
                                                    {c.topics.map((t) => (
                                                        <span key={t} className="bg-gray-200 px-2 py-0.5 rounded">
                                                            {t}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {chat.length === 0 && (
                    <div className="text-sm text-gray-500 text-center border rounded p-6 bg-white">
                        Ask a question to see RAG retrievals with citations.
                    </div>
                )}
            </div>
        </div>
    );
}
