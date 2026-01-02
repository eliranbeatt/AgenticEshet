import { redirect } from "next/navigation";

export default function IdeationPage({ params }: { params: { id: string } }) {
    redirect(`/projects/${params.id}/agent?stage=ideation`);
}

