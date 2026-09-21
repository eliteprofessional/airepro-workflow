import { prisma } from "@/lib/prisma";
import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import { logger } from "@/lib/logger";

// ─── Node & Edge Types ───────────────────────────────────────

export interface WorkflowNode {
    id: string;
    type: "trigger" | "send_message" | "delay" | "condition" | "http_request";
    position: { x: number; y: number };
    data: Record<string, any>;
}

export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string; // For condition nodes: "true" or "false"
}

interface WorkflowDef {
    id: string;
    sessionId: string;
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    isActive: boolean;
    triggerType: string;
    triggerValue: string | null;
    audience: string;
}

// ─── Variable Substitution ───────────────────────────────────

function substituteVariables(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

// ─── Trigger Matching ────────────────────────────────────────

function matchesTrigger(workflow: WorkflowDef, messageText: string): boolean {
    const incoming = messageText.toLowerCase();
    const value = (workflow.triggerValue || "").toLowerCase();

    switch (workflow.triggerType) {
        case "KEYWORD":
            return incoming === value;
        case "CONTAINS":
            return incoming.includes(value);
        case "REGEX":
            try {
                const regex = new RegExp(workflow.triggerValue || "", "i");
                return regex.test(messageText);
            } catch {
                return false;
            }
        case "ALL_MESSAGES":
            return true;
        default:
            return false;
    }
}

// ─── Node Executors ──────────────────────────────────────────

async function executeSendMessage(
    sock: WASocket,
    node: WorkflowNode,
    remoteJid: string,
    msg: WAMessage,
    vars: Record<string, string>
): Promise<void> {
    const { message, mediaUrl, mediaType } = node.data;

    if (mediaUrl) {
        const url = substituteVariables(mediaUrl, vars);
        const caption = message ? substituteVariables(message, vars) : undefined;
        let payload: any = {};

        if (caption) payload.caption = caption;

        switch (mediaType) {
            case "image":
                payload.image = { url };
                break;
            case "video":
                payload.video = { url };
                break;
            case "audio":
                payload = { audio: { url } };
                break;
            default:
                payload.document = { url };
                payload.mimetype = "application/octet-stream";
                payload.fileName = url.split("/").pop() || "document";
        }

        try {
            await sock.sendMessage(remoteJid, payload, { quoted: msg });
        } catch (err: any) {
            logger.error("Workflow", `Media send failed: ${err.message}`);
            if (message) {
                await sock.sendMessage(remoteJid, { text: substituteVariables(message, vars) }, { quoted: msg });
            }
        }
    } else if (message) {
        await sock.sendMessage(remoteJid, { text: substituteVariables(message, vars) }, { quoted: msg });
    }
}

async function executeDelay(node: WorkflowNode): Promise<void> {
    const seconds = Math.min(Math.max(node.data.seconds || 1, 0.5), 300); // 0.5s to 5min
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function evaluateCondition(node: WorkflowNode, vars: Record<string, string>): boolean {
    const { field, operator, value } = node.data;
    const fieldValue = (vars[field] || "").toLowerCase();
    const compareValue = (value || "").toLowerCase();

    switch (operator) {
        case "equals":
            return fieldValue === compareValue;
        case "not_equals":
            return fieldValue !== compareValue;
        case "contains":
            return fieldValue.includes(compareValue);
        case "not_contains":
            return !fieldValue.includes(compareValue);
        case "starts_with":
            return fieldValue.startsWith(compareValue);
        case "ends_with":
            return fieldValue.endsWith(compareValue);
        case "regex":
            try {
                return new RegExp(value || "", "i").test(vars[field] || "");
            } catch {
                return false;
            }
        default:
            return false;
    }
}

async function executeHttpRequest(node: WorkflowNode, vars: Record<string, string>): Promise<Record<string, string>> {
    const { url, method, headers, body } = node.data;
    const resolvedUrl = substituteVariables(url || "", vars);
    const resolvedBody = body ? substituteVariables(body, vars) : undefined;

    try {
        const parsedHeaders: Record<string, string> = {};
        if (headers) {
            try {
                const h = JSON.parse(substituteVariables(headers, vars));
                Object.assign(parsedHeaders, h);
            } catch {
                // Ignore invalid headers
            }
        }

        if (!parsedHeaders["Content-Type"] && resolvedBody) {
            parsedHeaders["Content-Type"] = "application/json";
        }

        const response = await fetch(resolvedUrl, {
            method: method || "GET",
            headers: parsedHeaders,
            body: method !== "GET" ? resolvedBody : undefined,
        });

        const responseText = await response.text();
        let responseData: string;

        try {
            const json = JSON.parse(responseText);
            responseData = typeof json === "string" ? json : JSON.stringify(json);
        } catch {
            responseData = responseText;
        }

        return {
            ...vars,
            http_status: String(response.status),
            http_response: responseData,
        };
    } catch (err: any) {
        logger.error("Workflow", `HTTP request failed: ${err.message}`);
        return {
            ...vars,
            http_status: "0",
            http_response: err.message,
        };
    }
}

// ─── Workflow Executor ───────────────────────────────────────

async function executeWorkflow(
    sock: WASocket,
    workflow: WorkflowDef,
    msg: WAMessage,
    remoteJid: string,
    messageText: string,
    senderJid: string
): Promise<void> {
    const nodes = workflow.nodes;
    const edges = workflow.edges;

    // Build adjacency map
    const adjacency = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
        if (!adjacency.has(edge.source)) {
            adjacency.set(edge.source, []);
        }
        adjacency.get(edge.source)!.push(edge);
    }

    // Find the trigger node (entry point)
    const triggerNode = nodes.find((n) => n.type === "trigger");
    if (!triggerNode) return;

    // Initialize variables
    let vars: Record<string, string> = {
        sender: senderJid,
        message: messageText,
        name: msg.pushName || senderJid.split("@")[0],
        remoteJid: remoteJid,
    };

    // Walk from trigger through connected nodes sequentially
    const visited = new Set<string>();
    const queue: string[] = [];
    visited.add(triggerNode.id);

    // Start from trigger's outgoing edges
    const triggerEdges = adjacency.get(triggerNode.id) || [];
    for (const edge of triggerEdges) {
        queue.push(edge.target);
    }

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = nodes.find((n) => n.id === nodeId);
        if (!node) continue;

        try {
            switch (node.type) {
                case "send_message":
                    await executeSendMessage(sock, node, remoteJid, msg, vars);
                    break;

                case "delay":
                    await executeDelay(node);
                    break;

                case "condition": {
                    const result = evaluateCondition(node, vars);
                    // Follow the matching branch
                    const condEdges = adjacency.get(nodeId) || [];
                    for (const edge of condEdges) {
                        const handle = edge.sourceHandle || "true";
                        if ((result && handle === "true") || (!result && handle === "false")) {
                            queue.push(edge.target);
                        }
                    }
                    continue; // Skip default edge following
                }

                case "http_request":
                    vars = await executeHttpRequest(node, vars);
                    break;

                case "trigger":
                    break;
            }

            // Follow outgoing edges (non-condition nodes fall through here)
            const outEdges = adjacency.get(nodeId) || [];
            for (const edge of outEdges) {
                queue.push(edge.target);
            }
        } catch (err) {
            logger.error("Workflow", `Error executing node ${node.type} (${nodeId}):`, err);
        }
    }
}

// ─── Public API ──────────────────────────────────────────────

export async function processWorkflows(
    sock: WASocket,
    sessionId: string,
    dbSessionId: string,
    msg: WAMessage,
    remoteJid: string,
    messageText: string,
    senderJid: string,
    isGroup: boolean
): Promise<boolean> {
    try {
        // Fetch active workflows for this session
        const workflows = await (prisma as any).workflow.findMany({
            where: {
                sessionId: dbSessionId,
                isActive: true,
            },
        });

        if (!workflows || workflows.length === 0) return false;

        for (const wf of workflows) {
            const workflow: WorkflowDef = {
                id: wf.id,
                sessionId: wf.sessionId,
                name: wf.name,
                nodes: (wf.nodes as any) || [],
                edges: (wf.edges as any) || [],
                isActive: wf.isActive,
                triggerType: wf.triggerType,
                triggerValue: wf.triggerValue,
                audience: (wf as any).audience || "ALL",
            };

            // Check audience
            if (workflow.audience === "GROUP" && !isGroup) continue;
            if (workflow.audience === "PRIVATE" && isGroup) continue;

            // Check trigger match
            if (!matchesTrigger(workflow, messageText)) continue;

            logger.info("Workflow", `Executing workflow "${workflow.name}" for ${remoteJid}`);

            // Execute the workflow (don't block other workflows)
            executeWorkflow(sock, workflow, msg, remoteJid, messageText, senderJid).catch((err) => {
                logger.error("Workflow", `Workflow "${workflow.name}" execution error:`, err);
            });

            // Return true to indicate a workflow matched (skip simple auto-reply)
            return true;
        }
    } catch (err) {
        logger.error("Workflow", "Error processing workflows:", err);
    }

    return false;
}
