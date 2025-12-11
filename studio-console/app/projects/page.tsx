"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type Doc } from "../../convex/_generated/dataModel";

export default function ProjectsPage() {
    const projects = useQuery(api.projects.listProjects);
    const createProject = useMutation(api.projects.createProject);
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);

    // --- Dev Tool: Seeding ---
    const seedSkills = useMutation(api.seed.seedSkillsPublic);
    const handleSeed = async () => {
        if (!confirm("Initialize system skills? (Run once)")) return;
        try {
            await seedSkills();
            alert("System initialized successfully!");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            alert("Seeding failed: " + message);
        }
    };
    // -------------------------

    const handleCreate = async () => {
        setIsCreating(true);
        try {
            const id = await createProject({
                name: "New Project " + new Date().toLocaleTimeString(),
                clientName: "New Client",
                details: {},
            });
            router.push(`/projects/${id}/overview`);
        } catch (e) {
            console.error(e);
            alert("Failed to create project");
        } finally {
            setIsCreating(false);
        }
    };

    if (projects === undefined) {
        return <div className="p-8">Loading projects...</div>;
    }

    return (
        <div className="p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold">Projects</h1>
                <div className="flex gap-2">
                     <button
                        onClick={handleSeed}
                        className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300 text-sm font-medium"
                    >
                        Initialize System
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={isCreating}
                        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                        {isCreating ? "Creating..." : "New Project"}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projects.map((p: Doc<"projects">) => (
                    <Link
                        key={p._id}
                        href={`/projects/${p._id}/overview`}
                        className="block bg-white p-6 rounded-lg shadow hover:shadow-md transition border border-gray-200"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <h2 className="text-xl font-semibold">{p.name}</h2>
                            <span className={`px-2 py-1 text-xs rounded-full uppercase font-medium ${p.status === "lead" ? "bg-yellow-100 text-yellow-800" :
                                    p.status === "planning" ? "bg-blue-100 text-blue-800" :
                                        p.status === "production" ? "bg-green-100 text-green-800" :
                                            "bg-gray-100 text-gray-800"
                                }`}>
                                {p.status}
                            </span>
                        </div>
                        <p className="text-gray-600 mb-4">{p.clientName}</p>
                        <div className="text-sm text-gray-500">
                            Created: {new Date(p.createdAt).toLocaleDateString()}
                        </div>
                    </Link>
                ))}

                {projects.length === 0 && (
                    <div className="col-span-full text-center py-12 text-gray-500 bg-white rounded-lg border border-dashed border-gray-300">
                        No projects found. Create one to get started.
                    </div>
                )}
            </div>
        </div>
    );
}
