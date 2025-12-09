"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function ProjectOverviewPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const project = useQuery(api.projects.getProject, { projectId });
    const tasks = useQuery(api.tasks.listByProject, { projectId });

    if (!project || !tasks) {
        return <div>Loading overview...</div>;
    }

    const todoCount = tasks.filter((t) => t.status === "todo").length;
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const doneCount = tasks.filter((t) => t.status === "done").length;

    return (
        <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded shadow-sm border">
                    <h3 className="text-gray-500 text-sm font-medium uppercase">Total Tasks</h3>
                    <p className="text-3xl font-bold mt-2">{tasks.length}</p>
                </div>
                <div className="bg-white p-6 rounded shadow-sm border">
                    <h3 className="text-gray-500 text-sm font-medium uppercase">To Do</h3>
                    <p className="text-3xl font-bold mt-2 text-yellow-600">{todoCount}</p>
                </div>
                <div className="bg-white p-6 rounded shadow-sm border">
                    <h3 className="text-gray-500 text-sm font-medium uppercase">In Progress</h3>
                    <p className="text-3xl font-bold mt-2 text-blue-600">{inProgressCount}</p>
                </div>
                <div className="bg-white p-6 rounded shadow-sm border">
                    <h3 className="text-gray-500 text-sm font-medium uppercase">Done</h3>
                    <p className="text-3xl font-bold mt-2 text-green-600">{doneCount}</p>
                </div>
            </div>

            {/* Details */}
            <div className="bg-white p-8 rounded shadow-sm border">
                <h2 className="text-xl font-bold mb-4">Project Details</h2>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-500">Event Date</label>
                        <div className="mt-1">{project.details.eventDate || "Not set"}</div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-500">Budget Cap</label>
                        <div className="mt-1">{project.details.budgetCap ? `$${project.details.budgetCap}` : "Not set"}</div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-500">Location</label>
                        <div className="mt-1">{project.details.location || "Not set"}</div>
                    </div>
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-500">Notes</label>
                        <div className="mt-1 text-gray-700 whitespace-pre-wrap">{project.details.notes || "No notes"}</div>
                    </div>
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Link
                    href={`/projects/${projectId}/clarification`}
                    className="bg-purple-50 p-6 rounded border border-purple-100 block hover:bg-purple-100 transition"
                >
                    <h3 className="text-purple-900 font-bold mb-2">Clarification</h3>
                    <p className="text-sm text-purple-700">Refine the brief and requirements with AI.</p>
                </Link>
                <Link
                    href={`/projects/${projectId}/planning`}
                    className="bg-blue-50 p-6 rounded border border-blue-100 block hover:bg-blue-100 transition"
                >
                    <h3 className="text-blue-900 font-bold mb-2">Planning</h3>
                    <p className="text-sm text-blue-700">Create and iterate on project plans.</p>
                </Link>
                <Link
                    href={`/projects/${projectId}/tasks`}
                    className="bg-gray-50 p-6 rounded border border-gray-100 block hover:bg-gray-100 transition"
                >
                    <h3 className="text-gray-900 font-bold mb-2">Tasks Board</h3>
                    <p className="text-sm text-gray-700">Manage tasks and sync with Trello.</p>
                </Link>
            </div>
        </div>
    );
}
