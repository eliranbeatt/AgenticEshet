"use client";

import { useParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { FlowWorkbench } from "../_components/flow/FlowWorkbench";

export default function SolutioningPage() {
    const params = useParams();
    const projectId = params.id as Id<"projects">;

    return <FlowWorkbench projectId={projectId} tab="solutioning" />;
}
