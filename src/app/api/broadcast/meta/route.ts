import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { z } from "zod";

const recipientItemSchema = z.union([
    z.string(),
    z.object({
        to: z.string(),
        placeholders: z.array(z.string()).optional()
    })
]);

const metaBroadcastSchema = z.object({
    recipients: z.array(recipientItemSchema).min(1, "At least one recipient is required"),
    type: z.enum(["text", "template"]).default("text"),
    message: z.string().optional(),
    templateId: z.union([z.number(), z.string()]).optional(),
    templateName: z.string().optional(),
    language: z.string().optional(),
    placeholders: z.array(z.string()).optional(),
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

        const {
            recipients,
            type,
            message,
            templateId,
            templateName,
            language,
            placeholders,
            apiKey,
            sessionId
        } = parseResult.data;

        // Clean & normalize recipient records
        const normalizedRecipients: { to: string; placeholders: string[] }[] = [];
        for (const item of recipients) {
            if (typeof item === "string") {
                const cleanNum = item.replace(/@.*$/, "").replace(/[^0-9]/g, "").trim();
                if (cleanNum.length >= 7) {
                    normalizedRecipients.push({ to: cleanNum, placeholders: placeholders || [] });
                }
            } else if (item && typeof item === "object") {
                const cleanNum = (item.to || "").replace(/@.*$/, "").replace(/[^0-9]/g, "").trim();
                if (cleanNum.length >= 7) {
                    normalizedRecipients.push({
                        to: cleanNum,
                        placeholders: item.placeholders || placeholders || []
                    });
                }
            }
        }

        if (normalizedRecipients.length === 0) {
            return NextResponse.json(
                { status: false, message: "No valid recipient phone numbers provided (min 7 digits)" },
                { status: 400 }
            );
        }

        const cleanPhoneNumbers = normalizedRecipients.map((r) => r.to);

        let data: any = null;
        let logMessageTitle = "";

        if (type === "template") {
            if (!templateName && !templateId) {
                return NextResponse.json(
                    { status: false, message: "Template name or ID is required for template broadcast" },
                    { status: 400 }
                );
            }

            logMessageTitle = `[Meta Template: ${templateName || templateId}]`;

            // Prepare payload according to Meta Bulk Template API
            const bulkTemplatePayload: Record<string, any> = {
                recipients: normalizedRecipients
            };
            if (templateId !== undefined && templateId !== null && String(templateId).trim() !== "") {
                const numId = Number(templateId);
                bulkTemplatePayload.templateId = isNaN(numId) ? templateId : numId;
            }
            if (templateName) {
                bulkTemplatePayload.templateName = templateName;
            }

            // 1. Try primary Endpoint: POST https://whatsapp.airepro.in/api/v1/messages/bulk-template
            let response = await fetch("https://whatsapp.airepro.in/api/v1/messages/bulk-template", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey.trim(),
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(bulkTemplatePayload)
            });

            // 2. If bulk-template endpoint is not implemented on server (404), fallback to standard bulk with template type
            if (response.status === 404) {
                const fallbackPayload = {
                    recipients: cleanPhoneNumbers,
                    type: "template",
                    template: {
                        name: templateName,
                        language: {
                            code: language || "en"
                        }
                    }
                };
                response = await fetch("https://whatsapp.airepro.in/api/v1/messages/bulk", {
                    method: "POST",
                    headers: {
                        "x-api-key": apiKey.trim(),
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(fallbackPayload)
                });
            }

            data = await response.json().catch(() => null);

            if (!response.ok || (data && (data.success === false || data.ok === false))) {
                const errorMsg =
                    data?.error || data?.message || `Meta Template API error with status ${response.status}`;
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
        } else {
            // Text broadcast mode
            if (!message || !message.trim()) {
                return NextResponse.json(
                    { status: false, message: "Message content cannot be empty" },
                    { status: 400 }
                );
            }

            logMessageTitle = `[Meta Bulk] ${message}`;

            const metaPayload = {
                recipients: cleanPhoneNumbers,
                type: "text",
                text: {
                    body: message.trim()
                }
            };

            const response = await fetch("https://whatsapp.airepro.in/api/v1/messages/bulk", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey.trim(),
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(metaPayload)
            });

            data = await response.json().catch(() => null);

            if (!response.ok || (data && (data.success === false || data.ok === false))) {
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
        }

        let broadcastId: string | undefined;
        const targetSessionId = sessionId || "meta-api";

        try {
            const acceptedCount =
                typeof data?.accepted === "number"
                    ? data.accepted
                    : typeof data?.successful === "number"
                    ? data.successful
                    : cleanPhoneNumbers.length;
            const failedCount = Math.max(0, cleanPhoneNumbers.length - acceptedCount);

            const jobs = Array.isArray(data?.jobs)
                ? data.jobs
                : Array.isArray(data?.results)
                ? data.results
                : [];
            const jobMap = new Map<string, any>();
            for (const j of jobs) {
                if (j.to) jobMap.set(String(j.to), j);
            }

            const log = await prisma.broadcastLog.create({
                data: {
                    sessionId: targetSessionId,
                    message: logMessageTitle,
                    total: cleanPhoneNumbers.length,
                    sent: acceptedCount,
                    failed: failedCount,
                    status: "completed",
                    delay: 0,
                    completedAt: new Date(),
                    recipients: {
                        create: cleanPhoneNumbers.map((num) => {
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
                    total: cleanPhoneNumbers.length,
                    sent: acceptedCount,
                    failed: failedCount,
                    progress: 100,
                    completedAt: new Date().toISOString()
                });
            }
        } catch (dbErr) {
            console.error("Failed to save Meta broadcast log to DB:", dbErr);
        }

        const acceptedCount =
            data?.accepted ?? data?.successful ?? cleanPhoneNumbers.length;

        return NextResponse.json({
            status: true,
            success: true,
            message: `Template broadcast queued via Meta API (${acceptedCount} recipients accepted)`,
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
