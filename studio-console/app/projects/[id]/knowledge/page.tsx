"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export default function KnowledgePage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    // Data
    const docs = useQuery(api.knowledge.listDocs, { projectId });
    const ingestionJobs = useQuery(api.ingestion.listJobs, { projectId });
    
    // Actions/Mutations
    const createJob = useMutation(api.ingestion.createJob);
    const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);
    const registerFile = useMutation(api.ingestion.registerFile);
    const processFile = useAction(api.ingestion.processFile);
    const createKnowledgeDoc = useMutation(api.knowledge.createDoc);
    const searchKnowledge = useAction(api.knowledge.search);

    // State
    const [activeTab, setActiveTab] = useState<"docs" | "upload" | "search">("docs");
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        const files = fileInputRef.current?.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            // 1. Create Job
            const jobId = await createJob({ projectId, name: `Upload ${new Date().toLocaleTimeString()}` });

            for (const file of Array.from(files)) {
                // 2. Get URL
                const postUrl = await generateUploadUrl();
                
                // 3. POST File
                const result = await fetch(postUrl, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                });
                const { storageId } = await result.json();

                // 4. Register
                const fileId = await registerFile({
                    jobId,
                    storageId,
                    filename: file.name,
                    mimeType: file.type,
                });

                // 5. Trigger Process (Async)
                // We fire and forget here, or we could await. Let's await to show immediate progress.
                await processFile({ fileId });

                // Quick hack: Auto-create knowledge doc if process succeeds?
                // Realistically, the user might want to review the enrichment first. 
                // But for now, let's assume we want to auto-index successfully processed files.
                // We'd need to fetch the file again to get the enriched text.
                // Or we can add a button "AddToKnowledge" in the UI.
            }
            setActiveTab("upload"); // Stay here or go to 'docs'
            alert("Upload and processing complete! Check the Ingestion status.");
        } catch (err) {
            console.error(err);
            alert("Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleAddToKnowledge = async (file: any) => {
        if (file.status !== "enriched" || !file.enrichedText && !file.rawText) return;
        
        try {
            const enriched = file.enrichedData ? file.enrichedData : {}; // Need to parse if stored as JSON?
            // Wait, schema says enrichedData is just separate fields.
            // Actually 'updateFileStatus' takes 'enrichedData' object but schema has individual fields.
            // Let's assume we grab summary/tags from the file record.
            
            // In 'processFile' we saved 'enrichedData' which updated 'summary', 'keyPointsJson' etc.
            
            await createKnowledgeDoc({
                projectId,
                title: file.originalFilename,
                storageId: file.storageId,
                summary: file.summary || "No summary",
                tags: file.suggestedTagsJson ? JSON.parse(file.suggestedTagsJson) : [],
                text: file.rawText || "",
            });
            alert("Added to Knowledge Base!");
        } catch (err) {
            console.error(err);
            alert("Failed to add to Knowledge Base");
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setIsSearching(true);
        try {
            const results = await searchKnowledge({ projectId, query: searchQuery });
            setSearchResults(results);
        } catch (err) {
            console.error(err);
        } finally {
            setIsSearching(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-12rem)]">
            {/* Tabs */}
            <div className="flex space-x-4 border-b px-4 bg-white">
                <button 
                    onClick={() => setActiveTab("docs")}
                    className={`py-2 px-4 border-b-2 font-medium ${activeTab === "docs" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"}`}
                >
                    Documents
                </button>
                <button 
                    onClick={() => setActiveTab("upload")}
                    className={`py-2 px-4 border-b-2 font-medium ${activeTab === "upload" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"}`}
                >
                    Ingestion & Upload
                </button>
                <button 
                    onClick={() => setActiveTab("search")}
                    className={`py-2 px-4 border-b-2 font-medium ${activeTab === "search" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500"}`}
                >
                    Search
                </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
                {activeTab === "docs" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {docs?.map((doc) => (
                            <div key={doc._id} className="bg-white p-4 rounded shadow border">
                                <h3 className="font-bold text-gray-800 mb-2 truncate" title={doc.title}>{doc.title}</h3>
                                <p className="text-xs text-gray-500 mb-2">{new Date(doc.createdAt).toLocaleDateString()}</p>
                                <p className="text-sm text-gray-700 line-clamp-3 mb-4">{doc.summary}</p>
                                <div className="flex flex-wrap gap-1">
                                    {doc.tags.map(t => (
                                        <span key={t} className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">{t}</span>
                                    ))}
                                </div>
                                <div className="mt-2 text-xs font-bold text-right uppercase text-blue-600">
                                    {doc.processingStatus}
                                </div>
                            </div>
                        ))}
                        {(!docs || docs.length === 0) && (
                            <div className="col-span-full text-center text-gray-400 py-10">
                                No documents in knowledge base. Go to Upload.
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "upload" && (
                    <div className="space-y-8">
                        {/* Upload Form */}
                        <div className="bg-white p-6 rounded shadow border">
                            <h3 className="font-bold text-lg mb-4">Upload New Files</h3>
                            <form onSubmit={handleUpload} className="flex gap-4 items-center">
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
                                    {uploading ? "Uploading..." : "Upload & Process"}
                                </button>
                            </form>
                        </div>

                        {/* Jobs List */}
                        <div className="space-y-4">
                            <h3 className="font-bold text-gray-700">Recent Ingestion Jobs</h3>
                            {ingestionJobs?.map((job) => (
                                <JobItem key={job._id} job={job} onAddToKnowledge={handleAddToKnowledge} />
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === "search" && (
                    <div className="max-w-2xl mx-auto">
                        <div className="flex gap-2 mb-8">
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
                                className="bg-blue-600 text-white px-6 rounded font-medium"
                            >
                                Search
                            </button>
                        </div>

                        <div className="space-y-4">
                            {searchResults.map((result) => (
                                <div key={result._id} className="bg-white p-4 rounded shadow border">
                                    <div className="text-xs text-gray-400 mb-1">Relevance: {Math.round(result.score * 100)}%</div>
                                    <p className="text-gray-800 text-sm whitespace-pre-wrap">{result.text}</p>
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

function JobItem({ job, onAddToKnowledge }: { job: any, onAddToKnowledge: (f: any) => void }) {
    // We need to fetch files for this job.
    // In a real app we'd likely have a subscription or specific component.
    // Let's use a sub-component with useQuery.
    const files = useQuery(api.ingestion.listFiles, { jobId: job._id });

    return (
        <div className="bg-white rounded border overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b flex justify-between items-center">
                <span className="font-bold text-sm text-gray-700">{job.name}</span>
                <span className="text-xs text-gray-500">{new Date(job.createdAt).toLocaleString()}</span>
            </div>
            <div className="p-4 space-y-2">
                {!files && <div className="text-sm text-gray-400">Loading files...</div>}
                {files?.map(file => (
                    <div key={file._id} className="flex justify-between items-center text-sm border-b last:border-0 pb-2 last:pb-0">
                        <div className="flex-1">
                            <div className="font-medium">{file.originalFilename}</div>
                            <div className="text-xs text-gray-500">
                                {file.status} 
                                {file.error && <span className="text-red-500 ml-2">Error: {file.error}</span>}
                            </div>
                        </div>
                        {file.status === "enriched" && (
                            <button 
                                onClick={() => onAddToKnowledge(file)}
                                className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200 hover:bg-green-100"
                            >
                                Add to Knowledge
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
