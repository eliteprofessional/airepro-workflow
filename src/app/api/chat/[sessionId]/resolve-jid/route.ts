import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";

/**
 * GET /api/chat/[sessionId]/resolve-jid?number=97792244580478
 * Resolves a number to the correct JID format (checks @s.whatsapp.net and @lid).
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ jid: null }, { status: 401 });
        }

        const { sessionId } = await params;
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ jid: null }, { status: 403 });
        }

        const number = request.nextUrl.searchParams.get("number");
        if (!number) {
            return NextResponse.json({ jid: null }, { status: 400 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId },
            select: { id: true }
        });

        if (!session) {
            return NextResponse.json({ jid: null }, { status: 404 });
        }

        // Check if messages exist with this number as remoteJid in any format
        const existingMsg = await prisma.message.findFirst({
            where: {
                sessionId: session.id,
                OR: [
                    { remoteJid: `${number}@s.whatsapp.net` },
                    { remoteJid: `${number}@lid` },
                ]
            },
            select: { remoteJid: true },
            orderBy: { timestamp: 'desc' }
        });

        if (existingMsg) {
            return NextResponse.json({ jid: existingMsg.remoteJid });
        }

        // Also check the Contact table
        const contact = await prisma.contact.findFirst({
            where: {
                sessionId: session.id,
                OR: [
                    { jid: `${number}@s.whatsapp.net` },
                    { jid: `${number}@lid` },
                    { lid: `${number}@lid` },
                ]
            },
            select: { jid: true, lid: true }
        });

        if (contact) {
            return NextResponse.json({ jid: contact.jid });
        }

        // Default: assume phone number format
        return NextResponse.json({ jid: `${number}@s.whatsapp.net` });
    } catch (error) {
        return NextResponse.json({ jid: null }, { status: 500 });
    }
}
