import { auth } from "@/lib/auth";
import { ChatInterface } from "@/components/chat/chat-interface";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { cookies } from "next/headers";
import { canAccessSession } from "@/lib/api-auth";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { prisma } from "@/lib/prisma";

export default async function ChatWithJidPage({
    params,
}: {
    params: Promise<{ jid: string }>;
}) {
    const { jid: rawJid } = await params;
    const session = await auth();

    if (!session?.user?.id) return <div>Unauthorized</div>;

    let clean = rawJid.replace(/\D/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.substring(1);

    const cookieStore = await cookies();
    const sessionId = cookieStore.get("sessionId")?.value;
    let validSessionId: string | null = null;

    if (sessionId) {
        const hasAccess = await canAccessSession(session.user.id, session.user.role, sessionId);
        if (hasAccess) {
            validSessionId = sessionId;
        }
    }

    if (!validSessionId) {
        return (
            <SessionGuard>
                <ChatInterface sessionId={null} />
            </SessionGuard>
        );
    }

    // Resolve the JID: check if this number is stored as a remoteJid in messages
    // (could be @s.whatsapp.net or @lid depending on how it was synced)
    let resolvedJid = `${clean}@s.whatsapp.net`;
    try {
        const dbSession = await prisma.session.findUnique({
            where: { sessionId: validSessionId },
            select: { id: true }
        });
        if (dbSession) {
            // Check if messages exist with this number as remoteJid (any suffix)
            const existingMsg = await prisma.message.findFirst({
                where: {
                    sessionId: dbSession.id,
                    OR: [
                        { remoteJid: `${clean}@s.whatsapp.net` },
                        { remoteJid: `${clean}@lid` },
                    ]
                },
                select: { remoteJid: true },
                orderBy: { timestamp: 'desc' }
            });
            if (existingMsg) {
                resolvedJid = existingMsg.remoteJid;
            }
        }
    } catch (e) {
        // Non-fatal: fall through to default @s.whatsapp.net
    }

    return (
        <div className="h-[calc(100vh-6.5rem)] sm:h-[calc(100vh-6rem)]">
            <ChatLayoutClient
                key={`${validSessionId}-${resolvedJid}`}
                sessionId={validSessionId}
                initialJid={resolvedJid}
            />
        </div>
    );
}
