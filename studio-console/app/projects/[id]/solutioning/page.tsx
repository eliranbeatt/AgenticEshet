import { redirect } from "next/navigation";

export default function SolutioningPage({ params }: { params: { id: string } }) {
    redirect(`/projects/${params.id}/chat?stage=solutioning`);
}
