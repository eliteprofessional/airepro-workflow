import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";

const metaBroadcastSchema = z.object({
    recipients: z.array(z.string()).min(1, "At least one recipient is required"),
    message: z.string().min(1, "Message cannot be empty"),
    apiKey: z.string().min(1, "Meta API key is required"),
    sessionId: z.string().optional()
});

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Unauthorized", error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const parseResult = metaBroadcastSchema.safeParse(body);
        if (!parseResult.success) {
            return NextResponse.json(
                { status: false, error: parseResult.error.flatten() },
                { status: 400 }
            );
        }

        const { recipients, message, apiKey, sessionId } = parseResult.data;

        // Clean recipient numbers: remove non-digits and WA domains
        const cleanRecipients = recipients
            .map((r) => r.replace(/@.*$/, "").replace(/[^0-9]/g, "").trim())
            .filter((r) => r.length >= 7);

        if (cleanRecipients.length === 0) {
            return NextResponse.json(
                { status: false, message: "No valid recipient phone numbers provided" },
                { status: 400 }
            );
        }

        // Call the Meta bulk broadcast API endpoint
        const metaApiUrl = "https://whatsapp.airepro.in/api/v1/messages/bulk";
        const metaPayload = {
            recipients: cleanRecipients,
            type: "text",
            text: {
                body: message
            }
        };

        const response = await fetch(metaApiUrl, {
            method: "POST",
            headers: {
                "x-api-key": apiKey.trim(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(metaPayload)
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || (data && data.success === false)) {
            const errorMsg =
                data?.error || data?.message || `Meta API error with status ${response.status}`;
            return NextResponse.json(
                {
                    status: false,
                    message: errorMsg,
                    error: errorMsg,
                    details: data
                },
                { status: response.status >= 400 && response.status < 500 ? response.status : 400 }
            );
        }

        let broadcastId: string | undefined;

        // Persist to BroadcastLog even if no Baileys device session is linked
        const targetSessionId = sessionId || "meta-api";
        try {
            const acceptedCount = typeof data?.accepted === "number" ? data.accepted : cleanRecipients.length;
            const failedCount = Math.max(0, cleanRecipients.length - acceptedCount);

            const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
            const jobMap = new Map<string, any>();
            for (const j of jobs) {
                if (j.to) jobMap.set(String(j.to), j);
            }

            const log = await prisma.broadcastLog.create({
                data: {
                    sessionId: targetSessionId,
                    message: `[Meta API] ${message}`,
                    total: cleanRecipients.length,
                    sent: acceptedCount,
                        failed: failedCount,
                        status: "completed",
                        delay: 0,
                        completedAt: new Date(),
                        recipients: {
                            create: cleanRecipients.map((num) => {
                                const job = jobMap.get(num);
                                const isFailed = job?.status === "failed";
                                return {
                                    jid: `${num}@s.whatsapp.net`,
                                    status: isFailed ? "failed" : "sent",
                                    error: job?.error || null,
                                    sentAt: new Date()
                                };
                            })
                        }
                    }
                });

                broadcastId = log.id;

                const io = (global as any).io;
                if (io) {
                    io.to(targetSessionId).emit("broadcast.progress", {
                        broadcastId: log.id,
                        status: "completed",
                        total: cleanRecipients.length,
                        sent: acceptedCount,
                        failed: failedCount,
                        progress: 100,
                        completedAt: new Date().toISOString()
                    });
                }
            } catch (dbErr) {
                console.error("Failed to save Meta broadcast log to DB:", dbErr);
            }

        return NextResponse.json({
            status: true,
            success: true,
            message: `Broadcast submitted via Meta API (${data?.accepted ?? cleanRecipients.length} queued)`,
            data: {
                ...data,
                broadcastId
            }
        });
    } catch (e: any) {
        console.error("Meta broadcast route error:", e);
        return NextResponse.json(
            { status: false, message: e.message || "Internal server error", error: e.message },
            { status: 500 }
        );
    }
}
