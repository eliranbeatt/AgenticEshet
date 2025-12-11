"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";

type PlanPhaseMeta = {
    activePlan: { planId: Id<"plans">; version: number; approvedAt: number } | null;
    latestPlan: { planId: Id<"plans">; version: number; isDraft: boolean } | null;
    totalPlans: number;
    draftCount: number;
} | null;

export default function ProjectLayout({ children }: { children: ReactNode }) {
    const params = useParams();
    const projectId = params.id as Id<"projects">;
    const project = useQuery(api.projects.getProject, { projectId });
    const planMeta = useQuery(api.projects.getPlanPhaseMeta, { projectId });
    const pathname = usePathname();

    const tabs = [
        { name: "Overview", href: "overview" },
        { name: "Clarification", href: "clarification", phaseKey: "clarification" as const },
        { name: "Planning", href: "planning", phaseKey: "planning" as const },
        { name: "Accounting", href: "accounting" },
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
                        const badge = getPhaseBadge(tab.phaseKey, project, planMeta);
                        return (
                            <Link
                                key={tab.name}
                                href={`/projects/${projectId}/${tab.href}`}
                                className={`pb-2 text-sm font-medium border-b-2 transition ${isActive
                                        ? "border-blue-600 text-blue-600"
                                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                                    }`}
                            >
                                <span>{tab.name}</span>
                                {badge && (
                                    <span className={`ml-2 text-[10px] uppercase px-2 py-0.5 rounded-full ${badge.className}`}>
                                        {badge.label}
                                    </span>
                                )}
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

function getPhaseBadge(
    phaseKey: "clarification" | "planning" | undefined,
    project: Doc<"projects"> | null | undefined,
    planMeta: PlanPhaseMeta | undefined
) {
    if (!phaseKey || !project) return null;

    if (phaseKey === "clarification") {
        return project.overviewSummary
            ? { label: "Ready", className: "bg-green-100 text-green-800" }
            : { label: "Pending", className: "bg-yellow-100 text-yellow-800" };
    }

    if (phaseKey === "planning") {
        if (planMeta?.activePlan) {
            return {
                label: `Active v${planMeta.activePlan.version}`,
                className: "bg-green-100 text-green-800",
            };
        }
        if (planMeta?.latestPlan) {
            return planMeta.latestPlan.isDraft
                ? { label: "Draft ready", className: "bg-yellow-100 text-yellow-800" }
                : { label: "Needs approval", className: "bg-orange-100 text-orange-800" };
        }
        return { label: "Not started", className: "bg-gray-100 text-gray-600" };
    }

    return null;
}
