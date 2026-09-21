"use server";

import { prisma } from "@/lib/prisma";
import { canAccessSession } from "@/lib/api-auth";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";

// ─── List Workflows ──────────────────────────────────────────

export async function getWorkflows(sessionId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const workflows = await (prisma as any).workflow.findMany({
        where: { sessionId: session.id },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            triggerType: true,
            triggerValue: true,
            audience: true,
            nodes: true,
            createdAt: true,
            updatedAt: true,
        }
    });

    return workflows;
}

// ─── Get Single Workflow ─────────────────────────────────────

export async function getWorkflow(sessionId: string, workflowId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const workflow = await (prisma as any).workflow.findUnique({
        where: { id: workflowId }
    });

    if (!workflow || workflow.sessionId !== session.id) {
        throw new Error("Workflow not found");
    }

    return workflow;
}

// ─── Create Workflow ─────────────────────────────────────────

export async function createWorkflow(sessionId: string, data: {
    name: string;
    description?: string;
    nodes: any[];
    edges: any[];
    triggerType: string;
    triggerValue?: string;
    audience?: string;
}) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    if (!data.name?.trim()) throw new Error("Name is required");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const workflow = await (prisma as any).workflow.create({
        data: {
            sessionId: session.id,
            name: data.name.trim(),
            description: data.description?.trim() || null,
            nodes: data.nodes || [],
            edges: data.edges || [],
            triggerType: data.triggerType || "KEYWORD",
            triggerValue: data.triggerValue || null,
            audience: data.audience || "ALL",
        }
    });

    return workflow;
}

// ─── Update Workflow ─────────────────────────────────────────

export async function updateWorkflow(sessionId: string, workflowId: string, data: {
    name?: string;
    description?: string;
    nodes?: any[];
    edges?: any[];
    triggerType?: string;
    triggerValue?: string;
    audience?: string;
    isActive?: boolean;
}) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const existing = await (prisma as any).workflow.findUnique({
        where: { id: workflowId }
    });

    if (!existing || existing.sessionId !== session.id) {
        throw new Error("Workflow not found");
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined) updateData.description = data.description?.trim() || null;
    if (data.nodes !== undefined) updateData.nodes = data.nodes;
    if (data.edges !== undefined) updateData.edges = data.edges;
    if (data.triggerType !== undefined) updateData.triggerType = data.triggerType;
    if (data.triggerValue !== undefined) updateData.triggerValue = data.triggerValue || null;
    if (data.audience !== undefined) updateData.audience = data.audience;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const workflow = await (prisma as any).workflow.update({
        where: { id: workflowId },
        data: updateData
    });

    return workflow;
}

// ─── Delete Workflow ─────────────────────────────────────────

export async function deleteWorkflow(sessionId: string, workflowId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const existing = await (prisma as any).workflow.findUnique({
        where: { id: workflowId }
    });

    if (!existing || existing.sessionId !== session.id) {
        throw new Error("Workflow not found");
    }

    await (prisma as any).workflow.delete({ where: { id: workflowId } });
    return { success: true };
}

// ─── Toggle Workflow Active State ────────────────────────────

export async function toggleWorkflow(sessionId: string, workflowId: string) {
    const nextAuthSession = await getAuthenticatedUserForAction();
    if (!nextAuthSession) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(nextAuthSession.id, nextAuthSession.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) throw new Error("Session not found");

    const existing = await (prisma as any).workflow.findUnique({
        where: { id: workflowId }
    });

    if (!existing || existing.sessionId !== session.id) {
        throw new Error("Workflow not found");
    }

    const workflow = await (prisma as any).workflow.update({
        where: { id: workflowId },
        data: { isActive: !existing.isActive }
    });

    return workflow;
}
