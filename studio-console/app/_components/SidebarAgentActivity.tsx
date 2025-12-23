"use client";

import type { Id } from "@/convex/_generated/dataModel";
import { useParams, usePathname } from "next/navigation";
import { AgentActivityPanel } from "../projects/[id]/_components/AgentActivityPanel";

export default function SidebarAgentActivity() {
    const pathname = usePathname();
    const params = useParams();
    const projectId = params?.id;

    if (typeof projectId !== "string") return null;
    if (!pathname?.startsWith(`/projects/${projectId}`)) return null;

    return (
        <div className="border-t border-sidebar-border px-3 py-3 h-[360px]">
            <AgentActivityPanel projectId={projectId as Id<"projects">} />
        </div>
    );
}
