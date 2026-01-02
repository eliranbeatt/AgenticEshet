import { redirect } from "next/navigation";

export default function PlanningPage({ params }: { params: { id: string } }) {
    redirect(`/projects/${params.id}/agent?stage=planning`);
}
