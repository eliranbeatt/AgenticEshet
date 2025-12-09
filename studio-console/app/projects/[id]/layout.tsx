"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";

export default function ProjectLayout({ children }: { children: ReactNode }) {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const project = useQuery(api.projects.getProject, { projectId });
    const pathname = usePathname();

    const tabs = [
        { name: "Overview", href: "overview" },
        { name: "Clarification", href: "clarification" },
        { name: "Planning", href: "planning" },
        { name: "Tasks", href: "tasks" },
        { name: "Quests", href: "quests" },
        { name: "Quote", href: "quote" },
        { name: "Trello View", href: "trello-view" },
        { name: "Knowledge", href: "knowledge" },
        { name: "History", href: "history" },
    ];

    if (project === undefined) {
        return <div className="p-8">Loading project...</div>;
    }

    if (project === null) {
        return <div className="p-8">Project not found</div>;
    }

    return (
        <div className="flex flex-col h-full">
            <div className="bg-white border-b px-8 py-4">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-bold">{project.name}</h1>
                        <div className="text-sm text-gray-500">
                            {project.clientName} • {project.status}
                        </div>
                    </div>
                    <div>
                        {/* Project Level Actions could go here */}
                    </div>
                </div>

                <div className="flex space-x-6">
                    {tabs.map((tab) => {
                        const isActive = pathname.includes(`/${tab.href}`);
                        return (
                            <Link
                                key={tab.name}
                                href={`/projects/${projectId}/${tab.href}`}
                                className={`pb-2 text-sm font-medium border-b-2 transition ${isActive
                                        ? "border-blue-600 text-blue-600"
                                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                                    }`}
                            >
                                {tab.name}
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 bg-gray-50 p-8 overflow-auto">
                {children}
            </div>
        </div>
    );
}
