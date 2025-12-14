"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";

export default function ConnectorsPage() {
    // In a real app, we'd list configured connectors here
    // const connectors = useQuery(api.connectors.list, {});
    const generateDriveAuthUrl = useAction(api.drive.generateAuthUrl);
    
    const [projectId, setProjectId] = useState(""); // Ideally selected from a dropdown

    const handleConnectDrive = async () => {
        if (!projectId) {
            alert("Please enter a Project ID (simulated selection)");
            return;
        }
        try {
            const url = await generateDriveAuthUrl({ projectId: projectId as any });
            window.location.href = url;
        } catch (error) {
            console.error("Failed to generate auth URL", error);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <h1 className="text-3xl font-bold mb-8">Data Connectors</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Google Drive Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-blue-600 font-bold">GD</span>
                        </div>
                        <h2 className="text-xl font-semibold">Google Drive</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Connect a Google Drive folder to automatically ingest documents.
                    </p>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Project ID (Debug)</label>
                        <input 
                            type="text" 
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            className="w-full border border-gray-300 rounded px-3 py-2"
                            placeholder="Enter Project ID..."
                        />
                    </div>
                    <button 
                        onClick={handleConnectDrive}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                    >
                        Connect Drive
                    </button>
                </div>

                {/* Email Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 opacity-75">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-green-600 font-bold">@</span>
                        </div>
                        <h2 className="text-xl font-semibold">Email Inbound</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Forward emails to <code>project-ID@inbound.yourdomain.com</code>
                    </p>
                    <button disabled className="w-full bg-gray-100 text-gray-500 px-4 py-2 rounded cursor-not-allowed">
                        Active by Default
                    </button>
                </div>

                {/* WhatsApp Card */}
                <div className="bg-white p-6 rounded-lg shadow border border-gray-200 opacity-50">
                    <div className="flex items-center mb-4">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-green-600 font-bold">WA</span>
                        </div>
                        <h2 className="text-xl font-semibold">WhatsApp</h2>
                    </div>
                    <p className="text-gray-600 mb-4">
                        Connect WhatsApp Business API.
                    </p>
                    <button disabled className="w-full bg-gray-100 text-gray-500 px-4 py-2 rounded cursor-not-allowed">
                        Coming Soon
                    </button>
                </div>
            </div>
        </div>
    );
}
