"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export default function UploadComponent({ jobId }: { jobId: Id<"ingestionJobs"> }) {
    const generateUploadUrl = useMutation(api.ingestion.generateUploadUrl);
    const addFilesToJob = useMutation(api.ingestion.addFilesToJob);
    const [uploading, setUploading] = useState(false);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setUploading(true);
        try {
            const fileData = [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const postUrl = await generateUploadUrl();
                
                const result = await fetch(postUrl, {
                    method: "POST",
                    headers: { "Content-Type": file.type },
                    body: file,
                });
                
                if (!result.ok) throw new Error(`Upload failed: ${result.statusText}`);
                const { storageId } = await result.json();
                
                fileData.push({
                    storageId,
                    name: file.name,
                    mimeType: file.type,
                    size: file.size,
                });
            }

            await addFilesToJob({ jobId, files: fileData });
        } catch (error) {
            console.error("Upload failed", error);
            alert("Upload failed. See console for details.");
        } finally {
            setUploading(false);
            // Reset input
            e.target.value = "";
        }
    };

    return (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:bg-gray-50 transition-colors">
            <input
                type="file"
                multiple
                onChange={handleUpload}
                disabled={uploading}
                className="hidden"
                id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
                <div className="space-y-2">
                    <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div className="text-sm text-gray-600">
                        {uploading ? (
                            <span className="font-medium text-blue-600">Uploading...</span>
                        ) : (
                            <span className="font-medium text-blue-600 hover:text-blue-500">Upload files</span>
                        )}
                    </div>
                    <p className="text-xs text-gray-500">PDF, Images, Office Docs up to 10MB</p>
                </div>
            </label>
        </div>
    );
}
