"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useState } from "react";

export function PrintingPanel({ projectId }: { projectId: Id<"projects"> }) {
    const files = useQuery(api.printing.listFiles, { projectId }); // Need to implement this query
    const [uploading, setUploading] = useState(false);

    // Mock upload handler
    const handleUpload = async () => {
        setUploading(true);
        // Simulate upload delay
        await new Promise(r => setTimeout(r, 1000));
        setUploading(false);
        alert("Upload simulation complete. Implement actual upload.");
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center p-4 border-b">
                <h3 className="font-bold text-sm text-gray-700">Printing Files</h3>
                <button 
                    onClick={handleUpload}
                    disabled={uploading}
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                >
                    {uploading ? "Uploading..." : "+ Upload File"}
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {!files ? (
                    <div className="text-gray-400 text-xs">Loading...</div>
                ) : files.length === 0 ? (
                    <div className="text-gray-400 text-xs text-center py-8">
                        No print files yet. Upload a PDF or Image.
                    </div>
                ) : (
                    files.map((file: any) => (
                        <div key={file._id} className="border rounded p-3 text-sm bg-gray-50">
                            <div className="flex justify-between">
                                <span className="font-medium truncate max-w-[150px]">{file.fileName}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                    file.qaStatus === "pass" ? "bg-green-100 text-green-700" :
                                    file.qaStatus === "fail" ? "bg-red-100 text-red-700" :
                                    "bg-yellow-100 text-yellow-700"
                                }`}>
                                    {file.qaStatus || "Pending QA"}
                                </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {file.metaDpi ? `${file.metaDpi} DPI` : "Unknown DPI"} • {file.metaColorMode || "Unknown Mode"}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
