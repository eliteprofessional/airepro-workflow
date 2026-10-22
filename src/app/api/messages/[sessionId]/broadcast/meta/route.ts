import { NextRequest, NextResponse } from "next/server";
import { POST as handleMetaBroadcast } from "@/app/api/broadcast/meta/route";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    
    // Inject sessionId into body if not present
    const updatedBody = {
        ...body,
        sessionId: body.sessionId || sessionId
    };

    const newRequest = new NextRequest(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(updatedBody)
    });

    return handleMetaBroadcast(newRequest);
}
