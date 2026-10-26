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
    templateBody: z.string().optional(),
    headerText: z.string().optional(),
    footerText: z.string().optional(),
    language: z.string().optional(),
    placeholders: z.array(z.string()).optional(),
    apiKey: z.string().min(1, "Meta API key is required"),
    sessionId: z.string().optional()
});

function renderTemplateWithPlaceholders(
    body: string,
    placeholders: string[],
    header?: string,
    footer?: string
): string {
    let result = body;
    placeholders.forEach((val, idx) => {
        const key = String(idx + 1);
        result = result.replaceAll(`{{${key}}}`, val);
    });

    let fullText = "";
    if (header && header.trim()) {
        fullText += `${header.trim()}\n\n`;
    }
    fullText += result.trim();
    if (footer && footer.trim()) {
        fullText += `\n\n_${footer.trim()}_`;
    }
    return fullText;
}

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
            templateBody,
            headerText,
            footerText,
            placeholders,
            apiKey,
            sessionId
        } = parseResult.data;

        // Clean & normalize recipient records
        const defaultPlaceholders = placeholders || [];
        const normalizedRecipients: { to: string; placeholders: string[] }[] = [];

        for (const item of recipients) {
            if (typeof item === "string") {
                const cleanNum = item.replace(/@.*$/, "").replace(/[^0-9]/g, "").trim();
                if (cleanNum.length >= 7) {
                    normalizedRecipients.push({ to: cleanNum, placeholders: defaultPlaceholders });
                }
            } else if (item && typeof item === "object") {
                const cleanNum = (item.to || "").replace(/@.*$/, "").replace(/[^0-9]/g, "").trim();
                if (cleanNum.length >= 7) {
                    normalizedRecipients.push({
                        to: cleanNum,
                        placeholders: item.placeholders && item.placeholders.length > 0
                            ? item.placeholders
                            : defaultPlaceholders
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

        let totalAccepted = 0;
        const allJobs: any[] = [];
        let logMessageTitle = "";

        if (type === "template") {
            // Template mode: Replace placeholders in template body and dispatch as raw messages
            let resolvedBody = (templateBody || message || "").trim();
            let resolvedHeader = (headerText || "").trim();
            let resolvedFooter = (footerText || "").trim();

            if (!resolvedBody) {
                // Fetch template definition from templates endpoint if body wasn't passed directly
                try {
                    const tplRes = await fetch("https://whatsapp.airepro.in/api/v1/templates", {
                        headers: { "x-api-key": apiKey.trim() }
                    });
                    const tplJson = await tplRes.json();
                    if (Array.isArray(tplJson?.templates)) {
                        const found = tplJson.templates.find((t: any) =>
                            (templateId !== undefined && String(t.id) === String(templateId)) ||
                            (templateName && t.name === templateName)
                        );
                        if (found?.body) {
                            resolvedBody = found.body;
                            if (found.header?.text) resolvedHeader = found.header.text;
                            if (found.footer) resolvedFooter = found.footer;
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch template body from API:", e);
                }
            }

            if (!resolvedBody) {
                return NextResponse.json(
                    { status: false, message: "Template body could not be found or is empty" },
                    { status: 400 }
                );
            }

            logMessageTitle = `[Custom Template: ${templateName || templateId || "Message"}]`;

            // Group recipients by their rendered message body
            const messageGroups = new Map<string, string[]>();
            for (const r of normalizedRecipients) {
                const rendered = renderTemplateWithPlaceholders(
                    resolvedBody,
                    r.placeholders,
                    resolvedHeader,
                    resolvedFooter
                );
                if (!messageGroups.has(rendered)) {
                    messageGroups.set(rendered, []);
                }
                messageGroups.get(rendered)!.push(r.to);
            }

            // Dispatch each distinct rendered message group via Meta bulk text endpoint
            for (const [renderedText, toList] of messageGroups.entries()) {
                const response = await fetch("https://whatsapp.airepro.in/api/v1/messages/bulk", {
                    method: "POST",
                    headers: {
                        "x-api-key": apiKey.trim(),
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        recipients: toList,
                        type: "text",
                        text: {
                            body: renderedText
                        }
                    })
                });

                const data = await response.json().catch(() => null);

                if (!response.ok || (data && (data.success === false || data.ok === false))) {
                    console.error("Meta group send error:", data);
                    // Mark as failed jobs for this group
                    toList.forEach((num) => {
                        allJobs.push({
                            jobId: "err_" + Date.now(),
                            to: num,
                            type: "text",
                            status: "failed",
                            error: data?.error || data?.message || "Send failed"
                        });
                    });
                } else {
                    const count = typeof data?.accepted === "number" ? data.accepted : toList.length;
                    totalAccepted += count;
                    if (Array.isArray(data?.jobs)) {
                        allJobs.push(...data.jobs);
                    } else {
                        toList.forEach((num) => {
                            allJobs.push({
                                jobId: "job_" + Math.random().toString(36).substring(2, 10),
                                to: num,
                                type: "text",
                                status: "queued"
                            });
                        });
                    }
                }
            }
        } else {
            // Plain text broadcast mode
            if (!message || !message.trim()) {
                return NextResponse.json(
                    { status: false, message: "Message content cannot be empty" },
                    { status: 400 }
                );
            }

            logMessageTitle = `[Meta Bulk] ${message.trim()}`;

            const response = await fetch("https://whatsapp.airepro.in/api/v1/messages/bulk", {
                method: "POST",
                headers: {
                    "x-api-key": apiKey.trim(),
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    recipients: cleanPhoneNumbers,
                    type: "text",
                    text: {
                        body: message.trim()
                    }
                })
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || (data && (data.success === false || data.ok === false))) {
                const errorMsg =
                    data?.error || data?.message || `Meta API error with status ${response.status}`;
                return NextResponse.json(
                    { status: false, message: errorMsg, error: errorMsg, details: data },
                    { status: response.status >= 400 && response.status < 500 ? response.status : 400 }
                );
            }

            totalAccepted = typeof data?.accepted === "number" ? data.accepted : cleanPhoneNumbers.length;
            if (Array.isArray(data?.jobs)) {
                allJobs.push(...data.jobs);
            }
        }

        let broadcastId: string | undefined;
        const targetSessionId = sessionId || "meta-api";

        try {
            const failedCount = Math.max(0, cleanPhoneNumbers.length - totalAccepted);
            const jobMap = new Map<string, any>();
            for (const j of allJobs) {
                if (j.to) jobMap.set(String(j.to), j);
            }

            const log = await prisma.broadcastLog.create({
                data: {
                    sessionId: targetSessionId,
                    message: logMessageTitle,
                    total: cleanPhoneNumbers.length,
                    sent: totalAccepted,
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
                    sent: totalAccepted,
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
            message: `Messages dispatched via Meta API (${totalAccepted} queued/sent)`,
            data: {
                success: true,
                accepted: totalAccepted,
                status: "queued",
                jobs: allJobs,
                broadcastId,
                timestamp: new Date().toISOString()
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
