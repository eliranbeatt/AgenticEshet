"use client";

import { Id } from "@/convex/_generated/dataModel";
import { useParams } from "next/navigation";
import { FlowWorkbench } from "../_components/flow/FlowWorkbench";

export default function IdeationPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    return <FlowWorkbench projectId={projectId} tab="ideation" />;
}

