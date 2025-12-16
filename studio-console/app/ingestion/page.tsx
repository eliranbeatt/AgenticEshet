"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { type Doc } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IngestionPage() {
    const jobs = useQuery(api.ingestion.listJobs, {}) as Array<Doc<"ingestionJobs">> | undefined;
    const createJob = useMutation(api.ingestion.createJob);
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);

    const handleCreateJob = async () => {
        setIsCreating(true);
        try {
            const jobId = await createJob({
                name: `Ingestion Job ${new Date().toLocaleString()}`,
                sourceType: "upload",
            });
            router.push(`/ingestion/${jobId}`);
        } catch (error) {
            console.error("Failed to create job", error);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold">Ingestion Console</h1>
                <div className="space-x-4">
                    <Link 
                        href="/ingestion/connectors"
                        className="bg-white text-gray-700 border border-gray-300 px-4 py-2 rounded hover:bg-gray-50"
                    >
                        Manage Connectors
                    </Link>
                    <button 
                        onClick={handleCreateJob}
                        disabled={isCreating}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isCreating ? "Creating..." : "New Upload Job"}
                    </button>
                </div>
            </div>

            <div className="bg-white shadow rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {jobs?.map((job) => (
                            <tr key={job._id}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <Link href={`/ingestion/${job._id}`} className="text-blue-600 hover:underline font-medium">
                                        {job.name}
                                    </Link>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                                    {job.sourceType}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                                        ${job.status === 'ready' ? 'bg-green-100 text-green-800' : 
                                          job.status === 'failed' ? 'bg-red-100 text-red-800' : 
                                          job.status === 'processing' || job.status === 'running' ? 'bg-yellow-100 text-yellow-800' : 
                                          'bg-gray-100 text-gray-800'}`}>
                                        {job.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {job.progress ? (
                                        <span>{job.progress.doneFiles} / {job.progress.totalFiles} files</span>
                                    ) : "-"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(job.createdAt).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <Link href={`/ingestion/${job._id}`} className="text-indigo-600 hover:text-indigo-900">
                                        View
                                    </Link>
                                </td>
                            </tr>
                        ))}
                        {jobs?.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                                    No ingestion jobs found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
