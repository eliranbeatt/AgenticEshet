"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useParams } from "next/navigation";
import UploadComponent from "../_components/UploadComponent";
import Link from "next/link";

export default function JobDetailsPage() {
    const params = useParams();
    const jobId = params.jobId as Id<"ingestionJobs">;
    
    const job = useQuery(api.ingestion.getJob, { jobId });
    const files = useQuery(api.ingestion.listFiles, { jobId });
    
    const runJob = useAction(api.ingestion.runJob);
    const retryJob = useMutation(api.ingestion.retryJob);
    const cancelJob = useMutation(api.ingestion.cancelJob);
    const retryFile = useMutation(api.ingestion.retryFile);

    if (!job) return <div className="p-8">Loading job...</div>;

    const handleRun = async () => {
        try {
            await runJob({ jobId });
        } catch (e) {
            console.error("Run failed", e);
            alert("Failed to start job");
        }
    };

    const handleRetry = async () => {
        if (confirm("Retry failed files?")) {
            await retryJob({ jobId });
        }
    };

    const handleCancel = async () => {
        if (confirm("Cancel job?")) {
            await cancelJob({ jobId });
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="mb-6">
                <Link href="/ingestion" className="text-blue-600 hover:underline">← Back to Jobs</Link>
            </div>

            <div className="bg-white shadow rounded-lg p-6 mb-8">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold mb-2">{job.name}</h1>
                        <div className="flex gap-4 text-sm text-gray-600">
                            <span>Status: <span className="font-semibold capitalize">{job.status}</span></span>
                            <span>Stage: <span className="font-semibold capitalize">{job.stage}</span></span>
                            <span>Source: <span className="font-semibold capitalize">{job.sourceType}</span></span>
                        </div>
                        {job.errorSummary && (
                            <div className="mt-2 text-red-600 text-sm bg-red-50 p-2 rounded">
                                Error: {job.errorSummary}
                            </div>
                        )}
                    </div>
                    <div className="space-x-2">
                        {(job.status === "created" || job.status === "queued") && (
                            <button 
                                onClick={handleRun}
                                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                            >
                                Start Processing
                            </button>
                        )}
                        {job.status === "failed" && (
                            <button 
                                onClick={handleRetry}
                                className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
                            >
                                Retry Failed
                            </button>
                        )}
                        {(job.status === "processing" || job.status === "running") && (
                            <button 
                                onClick={handleCancel}
                                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-6">
                    <h3 className="text-lg font-medium mb-2">Progress</h3>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div 
                            className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                            style={{ width: `${job.progress ? (job.progress.doneFiles / Math.max(job.progress.totalFiles, 1)) * 100 : 0}%` }}
                        ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>{job.progress?.doneFiles || 0} done</span>
                        <span>{job.progress?.failedFiles || 0} failed</span>
                        <span>{job.progress?.totalFiles || 0} total</span>
                    </div>
                </div>
            </div>

            {(job.status === "created" || job.status === "queued") && (
                <div className="mb-8">
                    <h3 className="text-lg font-medium mb-4">Add Files</h3>
                    <UploadComponent jobId={jobId} />
                </div>
            )}

            <div className="bg-white shadow rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium">Files</h3>
                </div>
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {files?.map((file) => (
                            <tr key={file._id}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {file.originalFilename}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {(file.sizeBytes / 1024).toFixed(1)} KB
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {file.stage}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                        ${file.status === 'ready' ? 'bg-green-100 text-green-800' : 
                                          file.status === 'failed' ? 'bg-red-100 text-red-800' : 
                                          'bg-gray-100 text-gray-800'}`}>
                                        {file.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                                    {file.error ? (
                                        <span className="text-red-600" title={file.error}>{file.error}</span>
                                    ) : (
                                        file.summary ? <span title={file.summary}>{file.summary.substring(0, 50)}...</span> : "-"
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    {file.status === "failed" && (
                                        <button 
                                            onClick={() => retryFile({ fileId: file._id })}
                                            className="text-indigo-600 hover:text-indigo-900"
                                        >
                                            Retry
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {files?.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                                    No files uploaded yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
