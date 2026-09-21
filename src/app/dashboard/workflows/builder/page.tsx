"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/components/dashboard/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    ArrowLeft,
    Save,
    Loader2,
    Zap,
    MessageSquare,
    Clock,
    GitBranch,
    Globe,
    Trash2,
    GripVertical,
    X,
} from "lucide-react";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { getWorkflow, createWorkflow, updateWorkflow } from "../actions";

// ─── Types ───────────────────────────────────────────────────

interface WorkflowNode {
    id: string;
    type: "trigger" | "send_message" | "delay" | "condition" | "http_request";
    position: { x: number; y: number };
    data: Record<string, any>;
}

interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
}

// ─── Node Config ─────────────────────────────────────────────

const NODE_TYPES = [
    { type: "trigger" as const, label: "Trigger", icon: Zap, color: "#f59e0b", description: "Entry point — matches incoming messages" },
    { type: "send_message" as const, label: "Send Message", icon: MessageSquare, color: "#3b82f6", description: "Send a text or media reply" },
    { type: "delay" as const, label: "Delay", icon: Clock, color: "#8b5cf6", description: "Wait before continuing" },
    { type: "condition" as const, label: "Condition", icon: GitBranch, color: "#10b981", description: "Branch based on message content" },
    { type: "http_request" as const, label: "HTTP Request", icon: Globe, color: "#ef4444", description: "Call an external API" },
];

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

// ─── Helpers ─────────────────────────────────────────────────

function generateId(): string {
    return `node_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function generateEdgeId(): string {
    return `edge_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ─── SVG Edge Component ─────────────────────────────────────

function EdgeSVG({
    x1,
    y1,
    x2,
    y2,
    selected,
    onClick,
    color = "#64748b",
}: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    selected: boolean;
    onClick: () => void;
    color?: string;
}) {
    const midY = (y1 + y2) / 2;
    const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

    return (
        <g onClick={onClick} style={{ cursor: "pointer" }}>
            {/* Invisible wider path for easier clicking */}
            <path d={path} fill="none" stroke="transparent" strokeWidth={20} />
            <path
                d={path}
                fill="none"
                stroke={selected ? "#3b82f6" : color}
                strokeWidth={selected ? 3 : 2}
                strokeDasharray={selected ? "none" : "none"}
                style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
            />
            {/* Animated flow dot */}
            <circle r={3} fill={selected ? "#3b82f6" : color}>
                <animateMotion dur="2s" repeatCount="indefinite" path={path} />
            </circle>
            {/* Arrow at end */}
            <circle cx={x2} cy={y2} r={4} fill={selected ? "#3b82f6" : color} />
        </g>
    );
}

// ─── Node Component ──────────────────────────────────────────

function WorkflowNodeComponent({
    node,
    selected,
    onMouseDown,
    onSelect,
    onPortClick,
    connectingFrom,
}: {
    node: WorkflowNode;
    selected: boolean;
    onMouseDown: (e: React.MouseEvent) => void;
    onSelect: () => void;
    onPortClick: (nodeId: string, type: "output" | "true" | "false" | "input") => void;
    connectingFrom: string | null;
}) {
    const config = NODE_TYPES.find((t) => t.type === node.type);
    if (!config) return null;
    const Icon = config.icon;

    return (
        <div
            className={`absolute select-none group`}
            style={{
                left: node.position.x,
                top: node.position.y,
                width: NODE_WIDTH,
                zIndex: selected ? 10 : 1,
            }}
            onMouseDown={(e) => {
                onSelect();
                onMouseDown(e);
            }}
        >
            {/* Input Port */}
            {node.type !== "trigger" && (
                <div
                    className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-background cursor-pointer hover:scale-125 transition-transform z-20"
                    style={{ backgroundColor: connectingFrom ? "#3b82f6" : "#94a3b8" }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPortClick(node.id, "input");
                    }}
                />
            )}

            {/* Node Body */}
            <div
                className={`rounded-xl border-2 bg-card shadow-lg transition-all duration-200 cursor-move ${
                    selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:shadow-xl"
                }`}
                style={{ borderColor: config.color + "60" }}
            >
                {/* Header */}
                <div
                    className="flex items-center gap-2 px-3 py-2 rounded-t-[10px]"
                    style={{ backgroundColor: config.color + "15" }}
                >
                    <div
                        className="w-6 h-6 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: config.color + "25" }}
                    >
                        <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                    </div>
                    <span className="text-xs font-semibold truncate">{config.label}</span>
                </div>

                {/* Body Preview */}
                <div className="px-3 py-2 text-[11px] text-muted-foreground truncate min-h-[32px]">
                    {node.type === "trigger" && (node.data.triggerValue || "Configure trigger...")}
                    {node.type === "send_message" && (node.data.message?.substring(0, 40) || "Configure message...")}
                    {node.type === "delay" && (node.data.seconds ? `Wait ${node.data.seconds}s` : "Configure delay...")}
                    {node.type === "condition" && (node.data.field ? `If ${node.data.field} ${node.data.operator || "equals"} ${node.data.value || "..."}` : "Configure condition...")}
                    {node.type === "http_request" && (node.data.url ? `${(node.data.method || "GET")} ${node.data.url.substring(0, 25)}...` : "Configure request...")}
                </div>
            </div>

            {/* Output Ports */}
            {node.type === "condition" ? (
                <>
                    <div className="absolute -bottom-2 left-1/4 -translate-x-1/2 flex flex-col items-center">
                        <div
                            className="w-4 h-4 rounded-full border-2 border-background cursor-pointer hover:scale-125 transition-transform z-20"
                            style={{ backgroundColor: "#10b981" }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onPortClick(node.id, "true");
                            }}
                        />
                        <span className="text-[9px] text-green-500 font-bold mt-0.5">YES</span>
                    </div>
                    <div className="absolute -bottom-2 left-3/4 -translate-x-1/2 flex flex-col items-center">
                        <div
                            className="w-4 h-4 rounded-full border-2 border-background cursor-pointer hover:scale-125 transition-transform z-20"
                            style={{ backgroundColor: "#ef4444" }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onPortClick(node.id, "false");
                            }}
                        />
                        <span className="text-[9px] text-red-500 font-bold mt-0.5">NO</span>
                    </div>
                </>
            ) : (
                <div
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-background cursor-pointer hover:scale-125 transition-transform z-20"
                    style={{ backgroundColor: config.color }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPortClick(node.id, "output");
                    }}
                />
            )}
        </div>
    );
}

// ─── Properties Panel ────────────────────────────────────────

function PropertiesPanel({
    node,
    onUpdate,
    onDelete,
    onClose,
}: {
    node: WorkflowNode;
    onUpdate: (data: Record<string, any>) => void;
    onDelete: () => void;
    onClose: () => void;
}) {
    const [data, setData] = useState(node.data);

    useEffect(() => {
        setData(node.data);
    }, [node.id, node.data]);

    const update = (key: string, value: any) => {
        const newData = { ...data, [key]: value };
        setData(newData);
        onUpdate(newData);
    };

    const config = NODE_TYPES.find((t) => t.type === node.type);

    return (
        <div className="w-80 border-l bg-card/95 backdrop-blur-sm flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
                <div className="flex items-center gap-2">
                    {config && (
                        <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: config.color + "20" }}
                        >
                            <config.icon className="w-4 h-4" style={{ color: config.color }} />
                        </div>
                    )}
                    <div>
                        <h3 className="text-sm font-semibold">{config?.label}</h3>
                        <p className="text-[10px] text-muted-foreground">{config?.description}</p>
                    </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* TRIGGER NODE */}
                {node.type === "trigger" && (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs">Match Type</Label>
                            <Select value={data.triggerType || "KEYWORD"} onValueChange={(v) => update("triggerType", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="KEYWORD">Exact Keyword</SelectItem>
                                    <SelectItem value="CONTAINS">Contains</SelectItem>
                                    <SelectItem value="REGEX">Regex Pattern</SelectItem>
                                    <SelectItem value="ALL_MESSAGES">All Messages</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {data.triggerType !== "ALL_MESSAGES" && (
                            <div className="space-y-2">
                                <Label className="text-xs">Trigger Value</Label>
                                <Input
                                    value={data.triggerValue || ""}
                                    onChange={(e) => update("triggerValue", e.target.value)}
                                    placeholder="e.g. hello, /start"
                                    className="h-9"
                                />
                            </div>
                        )}
                    </>
                )}

                {/* SEND MESSAGE NODE */}
                {node.type === "send_message" && (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs">Message</Label>
                            <Textarea
                                value={data.message || ""}
                                onChange={(e) => update("message", e.target.value)}
                                placeholder="Type your reply message..."
                                className="min-h-[100px] text-sm"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Variables: {"{{sender}}"}, {"{{message}}"}, {"{{name}}"}, {"{{http_response}}"}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Media URL (Optional)</Label>
                            <Input
                                value={data.mediaUrl || ""}
                                onChange={(e) => update("mediaUrl", e.target.value)}
                                placeholder="https://example.com/image.jpg"
                                className="h-9"
                            />
                        </div>
                        {data.mediaUrl && (
                            <div className="space-y-2">
                                <Label className="text-xs">Media Type</Label>
                                <Select value={data.mediaType || "image"} onValueChange={(v) => update("mediaType", v)}>
                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="image">Image</SelectItem>
                                        <SelectItem value="video">Video</SelectItem>
                                        <SelectItem value="document">Document</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </>
                )}

                {/* DELAY NODE */}
                {node.type === "delay" && (
                    <div className="space-y-2">
                        <Label className="text-xs">Delay (seconds)</Label>
                        <Input
                            type="number"
                            min={1}
                            max={300}
                            value={data.seconds || ""}
                            onChange={(e) => update("seconds", parseInt(e.target.value) || 1)}
                            placeholder="5"
                            className="h-9"
                        />
                        <p className="text-[10px] text-muted-foreground">Min: 1s, Max: 300s (5 minutes)</p>
                    </div>
                )}

                {/* CONDITION NODE */}
                {node.type === "condition" && (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs">Field</Label>
                            <Select value={data.field || "message"} onValueChange={(v) => update("field", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="message">Message Text</SelectItem>
                                    <SelectItem value="sender">Sender JID</SelectItem>
                                    <SelectItem value="name">Sender Name</SelectItem>
                                    <SelectItem value="http_response">HTTP Response</SelectItem>
                                    <SelectItem value="http_status">HTTP Status</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Operator</Label>
                            <Select value={data.operator || "contains"} onValueChange={(v) => update("operator", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="equals">Equals</SelectItem>
                                    <SelectItem value="not_equals">Not Equals</SelectItem>
                                    <SelectItem value="contains">Contains</SelectItem>
                                    <SelectItem value="not_contains">Not Contains</SelectItem>
                                    <SelectItem value="starts_with">Starts With</SelectItem>
                                    <SelectItem value="ends_with">Ends With</SelectItem>
                                    <SelectItem value="regex">Regex Match</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Value</Label>
                            <Input
                                value={data.value || ""}
                                onChange={(e) => update("value", e.target.value)}
                                placeholder="Compare value..."
                                className="h-9"
                            />
                        </div>
                    </>
                )}

                {/* HTTP REQUEST NODE */}
                {node.type === "http_request" && (
                    <>
                        <div className="space-y-2">
                            <Label className="text-xs">Method</Label>
                            <Select value={data.method || "GET"} onValueChange={(v) => update("method", v)}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="GET">GET</SelectItem>
                                    <SelectItem value="POST">POST</SelectItem>
                                    <SelectItem value="PUT">PUT</SelectItem>
                                    <SelectItem value="DELETE">DELETE</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">URL</Label>
                            <Input
                                value={data.url || ""}
                                onChange={(e) => update("url", e.target.value)}
                                placeholder="https://api.example.com/..."
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs">Headers (JSON)</Label>
                            <Textarea
                                value={data.headers || ""}
                                onChange={(e) => update("headers", e.target.value)}
                                placeholder='{"Authorization": "Bearer ..."}'
                                className="min-h-[60px] text-xs font-mono"
                            />
                        </div>
                        {data.method !== "GET" && (
                            <div className="space-y-2">
                                <Label className="text-xs">Body (JSON)</Label>
                                <Textarea
                                    value={data.body || ""}
                                    onChange={(e) => update("body", e.target.value)}
                                    placeholder='{"key": "{{message}}"}'
                                    className="min-h-[80px] text-xs font-mono"
                                />
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                            Response is stored in {"{{http_response}}"} and status in {"{{http_status}}"}
                        </p>
                    </>
                )}
            </div>

            {/* Delete Button */}
            <div className="p-4 border-t">
                <Button variant="destructive" size="sm" className="w-full" onClick={onDelete}>
                    <Trash2 className="w-3 h-3 mr-2" />
                    Delete Node
                </Button>
            </div>
        </div>
    );
}

// ─── Main Builder Component ──────────────────────────────────

function WorkflowBuilderInner() {
    const { sessionId } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const editId = searchParams.get("id");

    const canvasRef = useRef<HTMLDivElement>(null);
    const [nodes, setNodes] = useState<WorkflowNode[]>([]);
    const [edges, setEdges] = useState<WorkflowEdge[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [workflowName, setWorkflowName] = useState("New Workflow");
    const [workflowDesc, setWorkflowDesc] = useState("");
    const [audience, setAudience] = useState("ALL");
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(false);

    // Canvas state
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [scale, setScale] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

    // Drag state
    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
    const dragStart = useRef({ x: 0, y: 0, nx: 0, ny: 0 });

    // Connection state
    const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; handle: string } | null>(null);

    // Load existing workflow
    useEffect(() => {
        if (editId && sessionId) {
            setLoading(true);
            getWorkflow(sessionId, editId)
                .then((wf) => {
                    setWorkflowName(wf.name);
                    setWorkflowDesc(wf.description || "");
                    setAudience((wf as any).audience || "ALL");
                    setNodes((wf.nodes as any) || []);
                    setEdges((wf.edges as any) || []);
                })
                .catch((err: any) => {
                    toast.error(err.message || "Error loading workflow");
                    router.push("/dashboard/workflows");
                })
                .finally(() => setLoading(false));
        }
    }, [editId, sessionId]);

    // ─── Canvas Interactions ─────────────────────────────────

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((s) => Math.min(Math.max(s + delta, 0.3), 2));
    }, []);

    const handleCanvasMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (e.button === 1 || (e.button === 0 && e.altKey)) {
                // Middle click or Alt+Left click to pan
                setIsPanning(true);
                panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
            } else if (e.button === 0 && e.target === canvasRef.current?.querySelector(".canvas-bg")) {
                // Click on empty canvas — deselect
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setConnectingFrom(null);
            }
        },
        [offset]
    );

    const handleCanvasMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (isPanning) {
                const dx = e.clientX - panStart.current.x;
                const dy = e.clientY - panStart.current.y;
                setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
            }

            if (draggingNodeId) {
                const dx = (e.clientX - dragStart.current.x) / scale;
                const dy = (e.clientY - dragStart.current.y) / scale;
                setNodes((prev) =>
                    prev.map((n) =>
                        n.id === draggingNodeId
                            ? { ...n, position: { x: dragStart.current.nx + dx, y: dragStart.current.ny + dy } }
                            : n
                    )
                );
            }
        },
        [isPanning, draggingNodeId, scale]
    );

    const handleCanvasMouseUp = useCallback(() => {
        setIsPanning(false);
        setDraggingNodeId(null);
    }, []);

    // ─── Node Drag ───────────────────────────────────────────

    const handleNodeMouseDown = useCallback(
        (nodeId: string, e: React.MouseEvent) => {
            e.stopPropagation();
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) return;
            setDraggingNodeId(nodeId);
            dragStart.current = { x: e.clientX, y: e.clientY, nx: node.position.x, ny: node.position.y };
        },
        [nodes]
    );

    // ─── Port Click (Connections) ────────────────────────────

    const handlePortClick = useCallback(
        (nodeId: string, type: "output" | "true" | "false" | "input") => {
            if (type === "input") {
                // Completing a connection
                if (connectingFrom && connectingFrom.nodeId !== nodeId) {
                    // Check for duplicate
                    const exists = edges.some(
                        (e) => e.source === connectingFrom.nodeId && e.target === nodeId && e.sourceHandle === connectingFrom.handle
                    );
                    if (!exists) {
                        const newEdge: WorkflowEdge = {
                            id: generateEdgeId(),
                            source: connectingFrom.nodeId,
                            target: nodeId,
                            sourceHandle: connectingFrom.handle === "output" ? undefined : connectingFrom.handle,
                        };
                        setEdges((prev) => [...prev, newEdge]);
                    }
                }
                setConnectingFrom(null);
            } else {
                // Starting a connection
                setConnectingFrom({ nodeId, handle: type });
            }
        },
        [connectingFrom, edges]
    );

    // ─── Add Node ────────────────────────────────────────────

    const addNode = useCallback(
        (type: WorkflowNode["type"]) => {
            // Check if trigger already exists
            if (type === "trigger" && nodes.some((n) => n.type === "trigger")) {
                toast.error("Only one trigger node allowed per workflow");
                return;
            }

            const centerX = (-offset.x + 400) / scale;
            const centerY = (-offset.y + 300) / scale;

            const newNode: WorkflowNode = {
                id: generateId(),
                type,
                position: {
                    x: centerX + Math.random() * 100 - 50,
                    y: centerY + Math.random() * 100 - 50,
                },
                data: type === "trigger" ? { triggerType: "KEYWORD", triggerValue: "" } : {},
            };

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeId(newNode.id);
        },
        [nodes, offset, scale]
    );

    // ─── Delete ──────────────────────────────────────────────

    const deleteNode = useCallback(
        (nodeId: string) => {
            setNodes((prev) => prev.filter((n) => n.id !== nodeId));
            setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
            if (selectedNodeId === nodeId) setSelectedNodeId(null);
        },
        [selectedNodeId]
    );

    const deleteEdge = useCallback(
        (edgeId: string) => {
            setEdges((prev) => prev.filter((e) => e.id !== edgeId));
            if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
        },
        [selectedEdgeId]
    );

    // Handle keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Delete" || e.key === "Backspace") {
                // Don't delete if we're in an input/textarea
                if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
                if (selectedEdgeId) deleteEdge(selectedEdgeId);
                if (selectedNodeId) deleteNode(selectedNodeId);
            }
            if (e.key === "Escape") {
                setConnectingFrom(null);
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [selectedNodeId, selectedEdgeId, deleteEdge, deleteNode]);

    // ─── Save ────────────────────────────────────────────────

    const handleSave = async () => {
        if (!sessionId) return;

        // Get trigger info from trigger node
        const triggerNode = nodes.find((n) => n.type === "trigger");
        const triggerType = triggerNode?.data.triggerType || "KEYWORD";
        const triggerValue = triggerNode?.data.triggerValue || "";

        if (!workflowName.trim()) {
            toast.error("Workflow name is required");
            return;
        }

        if (!triggerNode) {
            toast.error("A trigger node is required");
            return;
        }

        setSaving(true);
        try {
            if (editId) {
                await updateWorkflow(sessionId, editId, {
                    name: workflowName,
                    description: workflowDesc,
                    nodes,
                    edges,
                    triggerType,
                    triggerValue,
                    audience,
                });
                toast.success("Workflow updated!");
            } else {
                await createWorkflow(sessionId, {
                    name: workflowName,
                    description: workflowDesc,
                    nodes,
                    edges,
                    triggerType,
                    triggerValue,
                    audience,
                });
                toast.success("Workflow created!");
            }
            router.push("/dashboard/workflows");
        } catch (error: any) {
            toast.error(error.message || "Error saving workflow");
        } finally {
            setSaving(false);
        }
    };

    // ─── Compute Edge Positions ──────────────────────────────

    const getEdgeCoords = (edge: WorkflowEdge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) return null;

        let x1 = sourceNode.position.x + NODE_WIDTH / 2;
        const y1 = sourceNode.position.y + NODE_HEIGHT + 8; // bottom of node

        // Adjust x for condition handles
        if (edge.sourceHandle === "true") {
            x1 = sourceNode.position.x + NODE_WIDTH / 4;
        } else if (edge.sourceHandle === "false") {
            x1 = sourceNode.position.x + (NODE_WIDTH * 3) / 4;
        }

        const x2 = targetNode.position.x + NODE_WIDTH / 2;
        const y2 = targetNode.position.y - 8; // top of node

        return { x1, y1, x2, y2 };
    };

    const selectedNode = nodes.find((n) => n.id === selectedNodeId);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[calc(100vh-120px)]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] -m-3 sm:-m-4 lg:-m-6">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm z-20">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/dashboard/workflows")}>
                    <ArrowLeft className="w-4 h-4" />
                </Button>
                <Input
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    className="h-8 max-w-[200px] text-sm font-semibold"
                    placeholder="Workflow name..."
                />
                <Select value={audience} onValueChange={setAudience}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">Everyone</SelectItem>
                        <SelectItem value="PRIVATE">Private Only</SelectItem>
                        <SelectItem value="GROUP">Groups Only</SelectItem>
                    </SelectContent>
                </Select>
                <div className="flex-1" />
                <Badge variant="outline" className="text-[10px]">
                    {nodes.length} nodes · {edges.length} edges
                </Badge>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Save className="w-3 h-3 mr-2" />}
                    Save
                </Button>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Node Palette */}
                <div className="w-56 border-r bg-card/50 p-3 flex flex-col gap-1.5 overflow-y-auto">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1 mb-1">
                        Drag to Canvas
                    </p>
                    {NODE_TYPES.map((nt) => {
                        const Icon = nt.icon;
                        const isDisabled = nt.type === "trigger" && nodes.some((n) => n.type === "trigger");
                        return (
                            <button
                                key={nt.type}
                                disabled={isDisabled}
                                onClick={() => addNode(nt.type)}
                                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
                                    isDisabled
                                        ? "opacity-40 cursor-not-allowed"
                                        : "hover:bg-muted/60 cursor-pointer active:scale-[0.97]"
                                }`}
                            >
                                <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: nt.color + "18" }}
                                >
                                    <Icon className="w-4 h-4" style={{ color: nt.color }} />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-xs font-medium truncate">{nt.label}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">{nt.description}</p>
                                </div>
                            </button>
                        );
                    })}

                    <div className="mt-auto pt-4 border-t text-[10px] text-muted-foreground/50 px-1 space-y-1">
                        <p>• Click a node to select & configure</p>
                        <p>• Click output port → input port to connect</p>
                        <p>• Alt + drag to pan canvas</p>
                        <p>• Scroll to zoom</p>
                        <p>• Delete/Backspace to remove selected</p>
                    </div>
                </div>

                {/* Canvas */}
                <div
                    ref={canvasRef}
                    className="flex-1 relative overflow-hidden bg-muted/20"
                    onWheel={handleWheel}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={handleCanvasMouseUp}
                >
                    {/* Grid background */}
                    <div
                        className="canvas-bg absolute inset-0"
                        style={{
                            backgroundImage: `radial-gradient(circle, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px)`,
                            backgroundSize: `${24 * scale}px ${24 * scale}px`,
                            backgroundPosition: `${offset.x}px ${offset.y}px`,
                        }}
                    />

                    {/* Transform container */}
                    <div
                        style={{
                            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                            transformOrigin: "0 0",
                            position: "absolute",
                            top: 0,
                            left: 0,
                        }}
                    >
                        {/* SVG Edges */}
                        <svg
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "5000px",
                                height: "5000px",
                                pointerEvents: "none",
                                overflow: "visible",
                            }}
                        >
                            <g style={{ pointerEvents: "auto" }}>
                                {edges.map((edge) => {
                                    const coords = getEdgeCoords(edge);
                                    if (!coords) return null;
                                    return (
                                        <EdgeSVG
                                            key={edge.id}
                                            {...coords}
                                            selected={selectedEdgeId === edge.id}
                                            onClick={() => {
                                                setSelectedEdgeId(edge.id);
                                                setSelectedNodeId(null);
                                            }}
                                            color={edge.sourceHandle === "true" ? "#10b981" : edge.sourceHandle === "false" ? "#ef4444" : "#64748b"}
                                        />
                                    );
                                })}
                            </g>
                        </svg>

                        {/* Nodes */}
                        {nodes.map((node) => (
                            <WorkflowNodeComponent
                                key={node.id}
                                node={node}
                                selected={selectedNodeId === node.id}
                                onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                                onSelect={() => {
                                    setSelectedNodeId(node.id);
                                    setSelectedEdgeId(null);
                                }}
                                onPortClick={handlePortClick}
                                connectingFrom={connectingFrom?.nodeId || null}
                            />
                        ))}
                    </div>

                    {/* Connection indicator */}
                    {connectingFrom && (
                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-medium shadow-lg animate-pulse">
                            Click an input port to complete connection · ESC to cancel
                        </div>
                    )}

                    {/* Empty state */}
                    {nodes.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                                    <GitBranch className="w-8 h-8 text-primary/50" />
                                </div>
                                <p className="text-sm font-medium text-muted-foreground">Start by adding a Trigger node</p>
                                <p className="text-xs text-muted-foreground/60 mt-1">Click a node type from the left palette</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Properties Panel */}
                {selectedNode && (
                    <PropertiesPanel
                        node={selectedNode}
                        onUpdate={(data) => {
                            setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? { ...n, data } : n)));
                        }}
                        onDelete={() => deleteNode(selectedNode.id)}
                        onClose={() => setSelectedNodeId(null)}
                    />
                )}
            </div>
        </div>
    );
}

// ─── Export with Suspense ────────────────────────────────────

export default function WorkflowBuilderPage() {
    return (
        <SessionGuard>
            <Suspense
                fallback={
                    <div className="flex items-center justify-center h-[calc(100vh-120px)]">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                }
            >
                <WorkflowBuilderInner />
            </Suspense>
        </SessionGuard>
    );
}
