"use client";

import { useState, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

type KnowledgeSearchResult = {
    chunkId: Id<"knowledgeChunks">;
    docId: Id<"knowledgeDocs">;
    text: string;
    score: number;
    doc: Pick<Doc<"knowledgeDocs">, "_id" | "title" | "summary" | "tags">;
};

const jobStatusStyles: Record<Doc<"ingestionJobs">["status"], string> = {
    created: "bg-gray-100 text-gray-700",
    processing: "bg-yellow-100 text-yellow-800",
    ready: "bg-blue-100 text-blue-700",
    committed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
};

const parseJsonList = (value?: string) => {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
};

export default function KnowledgePage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    const docs = useQuery(api.knowledge.listDocs, { projectId });
    const ingestionJobs = useQuery(api.ingestion.listJobs, { projectId });

    const createJob = useMutation(api.ingestion.createJob);
    const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);
    const registerFile = useMutation(api.ingestion.registerFile);
    const runIngestionJob = useAction(api.ingestion.runIngestionJob);
    const processFile = useAction(api.ingestion.processFile);
    const commitIngestionJob = useAction(api.ingestion.commitIngestionJob);
    const searchKnowledge = useAction(api.knowledge.search);

    const [activeTab, setActiveTab] = useState<"docs" | "upload" | "search">("docs");
    const [uploading, setUploading] = useState(false);
    const [jobName, setJobName] = useState(() => `Import ${new Date().toLocaleTimeString()}`);
    const [jobContext, setJobContext] = useState("");
    const [jobTags, setJobTags] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshJobName = () => setJobName(`Import ${new Date().toLocaleTimeString()}`);

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        const files = fileInputRef.current?.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const parsedTags = jobTags
                .split(",")
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0);

            const jobId = await createJob({
                projectId,
                name: jobName.trim() || `Import ${new Date().toLocaleString()}`,
                defaultContext: jobContext.trim() || undefined,
                defaultTags: parsedTags,
            });

            for (const file of Array.from(files)) {
                const postUrl = await generateUploadUrl();
                const result = await fetch(postUrl, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                });
                const { storageId } = await result.json();

                await registerFile({
                    jobId,
                    storageId,
                    filename: file.name,
                    mimeType: file.type || "application/octet-stream",
                });
            }

            await runIngestionJob({ jobId });
            alert("Files uploaded. The ingestion job is running now.");
        } catch (error: unknown) {
            console.error(error);
            const message = error instanceof Error ? error.message : "Upload failed";
            alert(message);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
            refreshJobName();
        }
    };

    const handleRunJob = async (jobId: Id<"ingestionJobs">) => {
        try {
            await runIngestionJob({ jobId });
        } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : "Unable to run ingestion job");
        }
    };

    const handleRetryFile = async (fileId: Id<"ingestionFiles">) => {
        try {
            await processFile({ fileId });
        } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : "Unable to reprocess file");
        }
    };

    const handleCommitFiles = async (jobId: Id<"ingestionJobs">, fileIds: Id<"ingestionFiles">[]) => {
        try {
            await commitIngestionJob({ jobId, fileIds });
        } catch (error) {
            console.error(error);
            alert(error instanceof Error ? error.message : "Commit failed");
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        try {
            const results = await searchKnowledge({ projectId, query: searchQuery });
            if (Array.isArray(results)) {
                setSearchResults(results as KnowledgeSearchResult[]);
            } else {
                setSearchResults([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)]">
            <div className="flex space-x-4 border-b px-4 bg-white">
                {(["docs", "upload", "search"] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`py-2 px-4 border-b-2 font-medium ${
                            activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"
                        }`}
                    >
                        {tab === "docs" && "Documents"}
                        {tab === "upload" && "Ingestion & Upload"}
                        {tab === "search" && "Search"}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-8">
                {activeTab === "docs" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {docs?.map((doc) => (
                            <div key={doc._id} className="bg-white p-4 rounded shadow border flex flex-col">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <h3 className="font-bold text-gray-800 truncate" title={doc.title}>
                                        {doc.title}
                                    </h3>
                                    <span className="text-xs uppercase font-semibold text-gray-500">
                                        {doc.processingStatus}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 mb-2">{new Date(doc.createdAt).toLocaleDateString()}</p>
                                <p className="text-sm text-gray-700 line-clamp-4 mb-4 flex-1">{doc.summary}</p>
                                <div className="flex flex-wrap gap-1 mt-auto">
                                    {doc.tags.map((tag) => (
                                        <span
                                            key={tag}
                                            className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded uppercase tracking-wide"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                        {(!docs || docs.length === 0) && (
                            <div className="col-span-full text-center text-gray-400 py-10">No documents yet.</div>
                        )}
                    </div>
                )}

                {activeTab === "upload" && (
                    <div className="space-y-8">
                        <div className="bg-white p-6 rounded shadow border space-y-6">
                            <h3 className="font-bold text-lg">Create ingestion job & upload files</h3>
                            <form onSubmit={handleUpload} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Job name</label>
                                        <input
                                            type="text"
                                            value={jobName}
                                            onChange={(e) => setJobName(e.target.value)}
                                            className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            placeholder="Import - January brief"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Default tags</label>
                                        <input
                                            type="text"
                                            value={jobTags}
                                            onChange={(e) => setJobTags(e.target.value)}
                                            className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            placeholder="proposal, budget, staffing"
                                        />
                                        <p className="text-xs text-gray-400 mt-1">Comma separated</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Context for enhancer</label>
                                    <textarea
                                        value={jobContext}
                                        onChange={(e) => setJobContext(e.target.value)}
                                        rows={3}
                                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="Remind the agent that this is for the Tel Aviv gala.."
                                    />
                                </div>
                                <div className="flex flex-col md:flex-row md:items-center gap-4">
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                        multiple
                                    />
                                    <button
                                        type="submit"
                                        disabled={uploading}
                                        className="bg-blue-600 text-white px-6 py-2 rounded font-medium disabled:opacity-50"
                                    >
                                        {uploading ? "Uploading..." : "Upload & queue job"}
                                    </button>
                                </div>
                            </form>
                        </div>

                        <div className="space-y-4">
                            <h3 className="font-bold text-gray-700">Ingestion jobs</h3>
                            {ingestionJobs?.map((job) => (
                                <JobItem
                                    key={job._id}
                                    job={job}
                                    onRunJob={handleRunJob}
                                    onRetryFile={handleRetryFile}
                                    onCommitFiles={handleCommitFiles}
                                />
                            ))}
                            {(!ingestionJobs || ingestionJobs.length === 0) && (
                                <div className="text-gray-400 text-center border rounded py-8 bg-white">
                                    No ingestion jobs yet.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "search" && (
                    <div className="max-w-3xl mx-auto space-y-8">
                        <div className="flex flex-col md:flex-row gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                placeholder="Search project knowledge..."
                                className="flex-1 border rounded p-3 shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={isSearching}
                                className="bg-blue-600 text-white px-6 rounded font-medium disabled:opacity-50"
                            >
                                {isSearching ? "Searching..." : "Search"}
                            </button>
                        </div>

                        <div className="space-y-4">
                            {searchResults.map((result) => (
                                <div key={result.chunkId} className="bg-white p-4 rounded shadow border space-y-3">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-sm font-semibold text-gray-800">{result.doc.title}</p>
                                            <p className="text-xs text-gray-500">
                                                Relevance: {Math.round(result.score * 100)}%
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {result.doc.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded uppercase"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <p className="text-sm text-gray-700 whitespace-pre-line">{result.text}</p>
                                    <p className="text-xs text-gray-500">{result.doc.summary}</p>
                                </div>
                            ))}
                            {searchResults.length === 0 && !isSearching && searchQuery && (
                                <div className="text-center text-gray-400">No results found.</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

type JobItemProps = {
    job: Doc<"ingestionJobs">;
    onRunJob: (jobId: Id<"ingestionJobs">) => Promise<void>;
    onCommitFiles: (jobId: Id<"ingestionJobs">, fileIds: Id<"ingestionFiles">[]) => Promise<void>;
    onRetryFile: (fileId: Id<"ingestionFiles">) => Promise<void>;
};

function JobItem({ job, onRunJob, onCommitFiles, onRetryFile }: JobItemProps) {
    const files = useQuery(api.ingestion.listFiles, { jobId: job._id });
    const [selectedIds, setSelectedIds] = useState<Id<"ingestionFiles">[]>([]);
    const [expandedId, setExpandedId] = useState<Id<"ingestionFiles"> | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [retryingId, setRetryingId] = useState<Id<"ingestionFiles"> | null>(null);

    useEffect(() => {
        setSelectedIds([]);
        setExpandedId(null);
    }, [job._id]);

    const readyIds = (files ?? []).filter((file) => file.status === "ready").map((file) => file._id);
    const readySet = new Set(readyIds);
    const selectableIds = selectedIds.filter((id) => readySet.has(id));

    const toggleSelection = (fileId: Id<"ingestionFiles">) => {
        setSelectedIds((prev) =>
            prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
        );
    };

    const handleRun = async () => {
        setIsRunning(true);
        try {
            await onRunJob(job._id);
        } finally {
            setIsRunning(false);
        }
    };

    const handleCommit = async (fileIds: Id<"ingestionFiles">[]) => {
        if (fileIds.length === 0) return;
        setIsCommitting(true);
        try {
            await onCommitFiles(job._id, fileIds);
            setSelectedIds([]);
        } finally {
            setIsCommitting(false);
        }
    };

    const handleRetry = async (fileId: Id<"ingestionFiles">) => {
        setRetryingId(fileId);
        try {
            await onRetryFile(fileId);
        } finally {
            setRetryingId(null);
        }
    };

    const defaultTags = job.defaultTags ?? [];

    return (
        <div className="bg-white rounded border overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                    <div className="font-bold text-sm text-gray-800">{job.name}</div>
                    <div className="text-xs text-gray-500">{new Date(job.createdAt).toLocaleString()}</div>
                    {job.defaultContext && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">Context: {job.defaultContext}</p>
                    )}
                    {defaultTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {defaultTags.map((tag) => (
                                <span
                                    key={tag}
                                    className="text-[10px] uppercase tracking-wide bg-gray-200 text-gray-700 px-2 py-0.5 rounded"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${jobStatusStyles[job.status]}`}>
                        {job.status}
                    </span>
                    <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="text-xs bg-blue-50 text-blue-700 px-3 py-1 rounded border border-blue-200 hover:bg-blue-100 disabled:opacity-50"
                    >
                        {isRunning ? "Running..." : "Run enrichment"}
                    </button>
                    <button
                        onClick={() => handleCommit(readyIds)}
                        disabled={isCommitting || readyIds.length === 0}
                        className="text-xs bg-green-50 text-green-700 px-3 py-1 rounded border border-green-200 hover:bg-green-100 disabled:opacity-50"
                    >
                        Commit all ready
                    </button>
                </div>
            </div>

            <div className="p-4 space-y-3">
                {!files && <div className="text-sm text-gray-400">Loading files...</div>}
                {files?.map((file) => {
                    const keyPoints = parseJsonList(file.keyPointsJson);
                    const keywords = parseJsonList(file.keywordsJson);
                    const suggestedTags = parseJsonList(file.suggestedTagsJson);
                    const canSelect = file.status === "ready";
                    const isExpanded = expandedId === file._id;

                    return (
                        <div key={file._id} className="border rounded p-3 space-y-2">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <div className="font-semibold text-sm text-gray-800">{file.originalFilename}</div>
                                    <div className="text-xs text-gray-500 flex flex-wrap gap-2">
                                        <span>Status: {file.status}</span>
                                        {file.error && <span className="text-red-500">Error: {file.error}</span>}
                                        {file.ragDocId && <span className="text-green-600">Committed</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {canSelect && (
                                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(file._id)}
                                                onChange={() => toggleSelection(file._id)}
                                            />
                                            Ready to commit
                                        </label>
                                    )}
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : file._id)}
                                        className="text-xs text-blue-600 underline"
                                    >
                                        {isExpanded ? "Hide details" : "Review"}
                                    </button>
                                    {(file.status === "ready" || file.status === "failed") && (
                                        <button
                                            onClick={() => handleRetry(file._id)}
                                            disabled={retryingId === file._id}
                                            className="text-xs text-gray-600 underline disabled:opacity-50"
                                        >
                                            {retryingId === file._id ? "Re-running..." : "Re-run"}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="bg-gray-50 rounded p-3 space-y-2 text-sm text-gray-700">
                                    <div>
                                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Summary</p>
                                        <p>{file.summary || "No summary available yet."}</p>
                                    </div>
                                    {keyPoints.length > 0 && (
                                        <div>
                                            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Key points</p>
                                            <ul className="list-disc list-inside space-y-1">
                                                {keyPoints.map((point, index) => (
                                                    <li key={index}>{point}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {keywords.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {keywords.map((keyword) => (
                                                <span
                                                    key={keyword}
                                                    className="text-[10px] uppercase tracking-wide bg-white border px-2 py-0.5 rounded"
                                                >
                                                    {keyword}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {suggestedTags.length > 0 && (
                                        <div className="flex flex-wrap gap-1">
                                            {suggestedTags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="text-[10px] uppercase tracking-wide bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {files && files.length > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t mt-2">
                        <div className="text-sm text-gray-600">
                            Selected {selectableIds.length} of {readyIds.length} ready files
                        </div>
                        <button
                            onClick={() => handleCommit(selectableIds)}
                            disabled={selectableIds.length === 0 || isCommitting}
                            className="text-xs bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
                        >
                            {isCommitting ? "Committing..." : "Commit selected"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
