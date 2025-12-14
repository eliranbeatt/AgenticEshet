import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { from, subject, text, projectId } = body;

        // In a real implementation, we would:
        // 1. Verify webhook signature
        // 2. Parse multipart data
        // 3. Upload attachments to Convex Storage via HTTP API
        // 4. Create inbox item

        const inboxItemId = await fetchMutation(api.inbox.createItem, {
            projectId: projectId, 
            source: "email",
            fromName: from,
            fromAddressOrPhone: from,
            subject: subject,
            bodyText: text || "(No Body)",
            attachments: [],
        });

        return NextResponse.json({ success: true, inboxItemId });
    } catch (error) {
        console.error("Email inbound failed", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
