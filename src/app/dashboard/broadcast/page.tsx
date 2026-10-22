"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    RefreshCw,
    Send,
    CheckCircle2,
    XCircle,
    Radio,
    Clock,
    AlertTriangle,
    History,
    Eye,
    EyeOff,
    Calendar,
    Sparkles,
    Key,
    Zap,
    ExternalLink,
    Info,
    Save
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/dashboard/session-provider";
import { useSocket } from "@/components/chat/socket-context";

interface BroadcastProgress {
    broadcastId: string;
    status: "running" | "completed";
    total: number;
    sent: number;
    failed: number;
    current?: string | null;
    progress?: number;
    errors?: { jid: string; error: string }[];
    startedAt?: string;
    completedAt?: string;
}

interface BroadcastLog {
    id: string;
    sessionId: string;
    message: string;
    total: number;
    sent: number;
    failed: number;
    status: string;
    delay: number;
    startedAt: string;
    completedAt: string | null;
    _count?: { recipients: number };
    recipients?: BroadcastRecipient[];
}

interface BroadcastRecipient {
    id: string;
    jid: string;
    status: string;
    error: string | null;
    sentAt: string | null;
}

interface MetaBulkJob {
    jobId: string;
    to: string;
    type: string;
    status: string;
    error?: string;
}

interface MetaBulkResponse {
    success: boolean;
    accepted: number;
    status: string;
    jobs?: MetaBulkJob[];
    timestamp?: string;
    broadcastId?: string;
}

const DEFAULT_META_API_KEY = "wak_599875_41f4cd35e8593640262935b9ecfe623114b9d70a36e63443";

export default function BroadcastPage() {
    const { sessionId } = useSession();
    // Default to 'meta' if no session is active, otherwise 'meta' or 'session'
    const [provider, setProvider] = useState<"meta" | "session">("meta");
    const [metaApiKey, setMetaApiKey] = useState<string>(DEFAULT_META_API_KEY);
    const [showApiKey, setShowApiKey] = useState(false);
    const [keySaved, setKeySaved] = useState(false);
    const [metaResponse, setMetaResponse] = useState<MetaBulkResponse | null>(null);

    const handleSaveApiKey = () => {
        if (!metaApiKey.trim()) {
            return toast.error("Please enter a token before saving");
        }
        try {
            localStorage.setItem("meta_broadcast_api_key", metaApiKey.trim());
            setKeySaved(true);
            toast.success("Meta API token saved successfully!");
            setTimeout(() => setKeySaved(false), 2500);
        } catch {
            toast.error("Failed to save token to browser storage");
        }
    };

    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");
    const [delay, setDelay] = useState([2000]);
    const [loading, setLoading] = useState(false);
    const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
    const [activeTab, setActiveTab] = useState<"new" | "history">("new");

    // History
    const [history, setHistory] = useState<BroadcastLog[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<BroadcastLog | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);

    const { getSocket, joinSession } = useSocket();

    // Load saved API key from localStorage
    useEffect(() => {
        try {
            const savedKey = localStorage.getItem("meta_broadcast_api_key");
            if (savedKey) {
                setMetaApiKey(savedKey);
            }
        } catch {}
    }, []);

    // Socket for progress updates
    useEffect(() => {
        const socket = getSocket();
        if (!socket || !sessionId) return;

        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = (data: BroadcastProgress) => {
            setBroadcastProgress(data);
            if (data.status === "completed") {
                setLoading(false);
                fetchHistory();
                if (data.failed === 0) {
                    toast.success(`Broadcast complete! ${data.sent} sent.`);
                } else {
                    toast.warning(`Broadcast complete. ${data.sent} sent, ${data.failed} failed.`);
                }
            }
        };

        socket.on("broadcast.progress", handler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("broadcast.progress", handler);
        };
    }, [sessionId, getSocket, joinSession]);

    // Fetch history
    const fetchHistory = useCallback(async () => {
        const activeSid = sessionId || "meta-api";
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/messages/${activeSid}/broadcast/history?limit=20`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data.data || []);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast history", e);
        } finally {
            setHistoryLoading(false);
        }
    }, [sessionId]);

    // Load history on mount & tab switch
    useEffect(() => {
        if (activeTab === "history") {
            fetchHistory();
        }
    }, [activeTab, fetchHistory]);

    // Open detail modal
    const openDetail = async (log: BroadcastLog) => {
        setSelectedLog(log);
        setDetailOpen(true);
        setDetailLoading(true);
        try {
            const activeSid = sessionId || log.sessionId || "meta-api";
            const res = await fetch(`/api/messages/${activeSid}/broadcast/history/${log.id}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedLog(data.data);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast detail", e);
        } finally {
            setDetailLoading(false);
        }
    };

    // Standard Baileys Session Broadcast
    const handleSessionSend = async () => {
        if (!sessionId) {
            return toast.error("No active WhatsApp Web session found. Please select or link a session, or use the Meta API.");
        }
        if (!message.trim()) return toast.error("Message cannot be empty");
        setLoading(true);
        setBroadcastProgress(null);
        setMetaResponse(null);

        try {
            const recipients = contacts
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => {
                    if (!s.includes("@")) return `${s}@s.whatsapp.net`;
                    return s;
                });

            if (recipients.length === 0) {
                toast.error("No recipients specified");
                setLoading(false);
                return;
            }

            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipients,
                    message,
                    delay: delay[0]
                })
            });

            const data = await res.json();

            if (res.ok) {
                toast.info(`Broadcast started for ${recipients.length} recipients...`);
            } else {
                toast.error(data.message || "Failed to start broadcast");
                setLoading(false);
            }
        } catch (e) {
            console.error(e);
            toast.error("Error sending broadcast");
            setLoading(false);
        }
    };

    // Meta WhatsApp Cloud API Broadcast (works with or without active session!)
    const handleMetaSend = async () => {
        if (!metaApiKey.trim()) return toast.error("Please enter your Meta API Key");
        if (!message.trim()) return toast.error("Message cannot be empty");

        // Clean phone numbers: remove domain, symbols, whitespace
        const cleanRecipients = contacts
            .split(/[\n,]+/)
            .map((s) => s.replace(/@.*$/, "").replace(/[^0-9]/g, "").trim())
            .filter((s) => s.length >= 7);

        if (cleanRecipients.length === 0) {
            return toast.error("No valid recipient phone numbers provided (min 7 digits with country code)");
        }

        setLoading(true);
        setBroadcastProgress(null);
        setMetaResponse(null);

        try {
            const res = await fetch("/api/broadcast/meta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    recipients: cleanRecipients,
                    message: message.trim(),
                    apiKey: metaApiKey.trim(),
                    sessionId: sessionId || "meta-api"
                })
            });

            const data = await res.json();

            if (res.ok && (data.success || data.status)) {
                const responseData: MetaBulkResponse = data.data || data;
                setMetaResponse(responseData);
                toast.success(
                    `Meta broadcast queued! ${responseData.accepted || cleanRecipients.length} recipients accepted.`
                );
                // Also set synthetic completed progress card
                setBroadcastProgress({
                    broadcastId: responseData.broadcastId || "meta-job-" + Date.now(),
                    status: "completed",
                    total: cleanRecipients.length,
                    sent: responseData.accepted ?? cleanRecipients.length,
                    failed: Math.max(0, cleanRecipients.length - (responseData.accepted ?? cleanRecipients.length)),
                    progress: 100
                });
                fetchHistory();
            } else {
                toast.error(data.message || data.error || "Failed to broadcast via Meta API");
            }
        } catch (e: any) {
            console.error("Meta broadcast error:", e);
            toast.error(e.message || "Network error while connecting to Meta API");
        } finally {
            setLoading(false);
        }
    };

    const recipientNumbers = contacts
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const recipientCount = recipientNumbers.length;

    const formatJid = (jid: string) => {
        if (!jid) return "-";
        return jid.replace("@s.whatsapp.net", "").replace("@g.us", " (Group)");
    };

    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    };

    const tabs = [
        { id: "new" as const, label: "New Broadcast", icon: Send },
        { id: "history" as const, label: "History", icon: History }
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Broadcast / Blast</h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        Send bulk messages to multiple recipients via Meta WhatsApp API or linked session device.
                    </p>
                </div>

                {/* Quick Button to toggle Meta / Standard engine */}
                <div className="flex items-center gap-2">
                    {provider === "session" ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProvider("meta")}
                            className="border-emerald-500/30 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 font-medium"
                        >
                            <Sparkles className="h-4 w-4 mr-1.5 text-emerald-500" />
                            Use Meta API
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setProvider("session")}
                            className="font-medium"
                        >
                            <Radio className="h-4 w-4 mr-1.5 text-blue-500" />
                            Use Session Device
                        </Button>
                    )}
                </div>
            </div>

            {/* Notification when no session is active */}
            {!sessionId && (
                <div className="flex items-center gap-2.5 p-3 rounded-lg border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 text-xs">
                    <Info className="h-4 w-4 text-emerald-600 shrink-0" />
                    <p className="text-muted-foreground">
                        <strong className="text-foreground">Meta API Ready:</strong> No WhatsApp session is configured, but you can send broadcasts directly using the <span className="font-semibold text-emerald-600 dark:text-emerald-400">Meta Bulk API</span> below with your API key.
                    </p>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                            activeTab === tab.id
                                ? "bg-background shadow-sm text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <tab.icon className="h-4 w-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === "new" && (
                <>
                    {/* Broadcasting Provider Selector */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card/60 backdrop-blur-sm shadow-xs">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">Broadcasting Mode:</span>
                                {provider === "meta" ? (
                                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold gap-1">
                                        <Sparkles className="h-3 w-3" />
                                        Meta Cloud Gateway (whatsapp.airepro.in)
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold gap-1">
                                        <Radio className="h-3 w-3" />
                                        Linked Device Session
                                    </Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {provider === "meta"
                                    ? "Dispatches high-volume messages via official Meta Cloud API with instant queuing. No session required."
                                    : "Sends sequentially via your connected WhatsApp Web device with anti-ban delay."}
                            </p>
                        </div>

                        <div className="flex items-center gap-1.5 bg-muted/80 p-1 rounded-lg shrink-0">
                            <Button
                                type="button"
                                size="sm"
                                variant={provider === "meta" ? "default" : "ghost"}
                                onClick={() => setProvider("meta")}
                                className={`text-xs h-8 px-3 gap-1.5 ${
                                    provider === "meta" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""
                                }`}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                Meta API (Bulk)
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={provider === "session" ? "default" : "ghost"}
                                onClick={() => setProvider("session")}
                                className="text-xs h-8 px-3"
                            >
                                Standard Session
                            </Button>
                        </div>
                    </div>

                    {/* Meta API Configuration Card (ALWAYS accessible and prominent!) */}
                    <Card className={`transition-all border-2 ${
                        provider === "meta" 
                            ? "border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10" 
                            : "border-muted bg-muted/20"
                    }`}>
                        <CardHeader className="pb-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                                    <Key className="h-4 w-4 text-emerald-500" />
                                    Meta Gateway API Key (`x-api-key`)
                                    {provider === "meta" && (
                                        <Badge className="bg-emerald-600 text-white text-[10px] ml-1">Active Engine</Badge>
                                    )}
                                </CardTitle>
                                <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                                    https://whatsapp.airepro.in/api/v1/messages/bulk
                                    <ExternalLink className="h-3 w-3" />
                                </span>
                            </div>
                            <CardDescription className="text-xs">
                                Enter your Airepro WhatsApp Gateway API Key. You can broadcast with this key directly even if no WhatsApp device session is connected.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                <div className="relative flex-1">
                                    <Input
                                        type={showApiKey ? "text" : "password"}
                                        placeholder="wak_599875_..."
                                        value={metaApiKey}
                                        onChange={(e) => {
                                            setMetaApiKey(e.target.value);
                                            setKeySaved(false);
                                        }}
                                        className="font-mono text-xs pr-10 border-emerald-500/30 focus-visible:ring-emerald-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                        tabIndex={-1}
                                        title={showApiKey ? "Hide Token" : "Show Token"}
                                    >
                                        {showApiKey ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={handleSaveApiKey}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs whitespace-nowrap gap-1.5 shadow-xs"
                                    >
                                        {keySaved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                                        {keySaved ? "Saved!" : "Save Token"}
                                    </Button>

                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setMetaApiKey(DEFAULT_META_API_KEY);
                                            try {
                                                localStorage.setItem("meta_broadcast_api_key", DEFAULT_META_API_KEY);
                                            } catch {}
                                            setKeySaved(false);
                                            toast.success("Reset to default Airepro API key");
                                        }}
                                        className="text-xs whitespace-nowrap"
                                    >
                                        Reset Default
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                    <Zap className="h-3.5 w-3.5" /> High throughput direct queuing
                                </span>
                                <span>•</span>
                                <span>Header: <code className="font-mono text-xs font-semibold">x-api-key</code></span>
                                <span>•</span>
                                <span>Saved in browser storage</span>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                        {/* Recipients Card */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <CardTitle>Recipients</CardTitle>
                                    <Badge variant="secondary" className="font-mono">
                                        {recipientCount} numbers
                                    </Badge>
                                </div>
                                <CardDescription>
                                    Enter recipient phone numbers separated by comma or new line.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>
                                        Target Numbers (e.g. 628123456789, 628123235268)
                                    </Label>
                                    <Textarea
                                        placeholder={"628123456789\n628123235268"}
                                        className="min-h-[220px] font-mono text-sm"
                                        value={contacts}
                                        onChange={(e) => setContacts(e.target.value)}
                                        disabled={loading}
                                    />
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{recipientCount} numbers identified</span>
                                        <span className="text-emerald-600 dark:text-emerald-400">
                                            Auto-cleans formatting & symbols
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Message Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Message Content</CardTitle>
                                <CardDescription>Compose the broadcast text message.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Message</Label>
                                    <Textarea
                                        placeholder="Type your broadcast message here..."
                                        className="min-h-[140px]"
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        disabled={loading}
                                    />
                                </div>

                                {provider === "meta" ? (
                                    /* Meta API Action Area */
                                    <div className="space-y-3 pt-2">
                                        <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-950/20 text-xs space-y-1">
                                            <div className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                                <Zap className="h-4 w-4" /> Direct Meta Bulk Queue
                                            </div>
                                            <p className="text-muted-foreground">
                                                Sends directly via <code className="font-mono">https://whatsapp.airepro.in/api/v1/messages/bulk</code>. No local session required.
                                            </p>
                                        </div>

                                        <Button
                                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-10 shadow-sm"
                                            onClick={handleMetaSend}
                                            disabled={
                                                loading ||
                                                recipientCount === 0 ||
                                                !message.trim() ||
                                                !metaApiKey.trim()
                                            }
                                        >
                                            {loading ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Sparkles className="mr-2 h-4 w-4" />
                                            )}
                                            {loading ? "Queueing via Meta API..." : "Broadcast via Meta API"}
                                        </Button>
                                    </div>
                                ) : (
                                    /* Standard Session Action Area */
                                    <div className="space-y-3 pt-2">
                                        <div className="space-y-2">
                                            <Label>Delay: {(delay[0] / 1000).toFixed(1)}s</Label>
                                            <Slider
                                                defaultValue={[2000]}
                                                min={1000}
                                                max={15000}
                                                step={500}
                                                value={delay}
                                                onValueChange={setDelay}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Delay antar pesan (+ random) untuk mengurangi risiko ban.
                                            </p>
                                        </div>

                                        <div className="flex flex-col gap-2 pt-2">
                                            <Button
                                                className="w-full"
                                                onClick={handleSessionSend}
                                                disabled={loading || recipientCount === 0 || !message.trim()}
                                            >
                                                {loading ? (
                                                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Send className="mr-2 h-4 w-4" />
                                                )}
                                                {loading ? "Broadcasting..." : "Start Broadcast (Session)"}
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="w-full text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 border-emerald-500/30"
                                                onClick={() => setProvider("meta")}
                                            >
                                                <Sparkles className="mr-2 h-4 w-4" />
                                                Use Meta API Instead
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Meta API Response Summary */}
                    {metaResponse && (
                        <Card className="border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="flex items-center gap-2 text-lg text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="h-5 w-5" />
                                        Meta Bulk Broadcast Dispatched
                                    </CardTitle>
                                    <Badge className="bg-emerald-600 text-white uppercase text-[10px]">
                                        {metaResponse.status}
                                    </Badge>
                                </div>
                                <CardDescription>
                                    {metaResponse.timestamp && `Timestamp: ${formatTime(metaResponse.timestamp)}`}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div className="bg-background rounded-lg p-3 text-center border">
                                        <div className="text-2xl font-bold text-emerald-600">{metaResponse.accepted}</div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <CheckCircle2 className="h-3 w-3" /> Accepted / Queued
                                        </div>
                                    </div>
                                    <div className="bg-background rounded-lg p-3 text-center border">
                                        <div className="text-2xl font-bold text-foreground">
                                            {metaResponse.jobs?.length || metaResponse.accepted}
                                        </div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <Send className="h-3 w-3" /> Total Jobs
                                        </div>
                                    </div>
                                    <div className="bg-background rounded-lg p-3 text-center border col-span-2 sm:col-span-1">
                                        <div className="text-2xl font-bold text-blue-600">Active</div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <Clock className="h-3 w-3" /> Cloud Queue
                                        </div>
                                    </div>
                                </div>

                                {/* Jobs breakdown */}
                                {metaResponse.jobs && metaResponse.jobs.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                            Queued Jobs ({metaResponse.jobs.length})
                                        </h4>
                                        <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border bg-background/50 p-2">
                                            {metaResponse.jobs.map((job, idx) => (
                                                <div
                                                    key={job.jobId || idx}
                                                    className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-muted/40 font-mono"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-emerald-500">●</span>
                                                        <span className="font-semibold">{job.to}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-muted-foreground text-[11px] truncate max-w-[120px]">
                                                            {job.jobId}
                                                        </span>
                                                        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                                                            {job.status}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Live Baileys Socket Progress */}
                    {broadcastProgress && !metaResponse && (
                        <Card
                            className={`border-2 transition-colors ${
                                broadcastProgress.status === "completed"
                                    ? broadcastProgress.failed === 0
                                        ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10"
                                        : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10"
                                    : "border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/10"
                            }`}
                        >
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    {broadcastProgress.status === "running" ? (
                                        <>
                                            <Radio className="h-5 w-5 text-blue-500 animate-pulse" />
                                            <span>Broadcast In Progress</span>
                                        </>
                                    ) : broadcastProgress.failed === 0 ? (
                                        <>
                                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                                            <span>Broadcast Completed</span>
                                        </>
                                    ) : (
                                        <>
                                            <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                            <span>Broadcast Completed with Errors</span>
                                        </>
                                    )}
                                </CardTitle>
                                <CardDescription>ID: {broadcastProgress.broadcastId}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Progress</span>
                                        <span className="font-mono font-medium">
                                            {broadcastProgress.sent + broadcastProgress.failed} / {broadcastProgress.total} (
                                            {broadcastProgress.progress || 0}%)
                                        </span>
                                    </div>
                                    <Progress value={broadcastProgress.progress || 0} className="h-3" />
                                </div>

                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-background rounded-lg p-3 text-center border">
                                        <div className="text-2xl font-bold text-green-600">{broadcastProgress.sent}</div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <CheckCircle2 className="h-3 w-3" /> Sent
                                        </div>
                                    </div>
                                    <div className="bg-background rounded-lg p-3 text-center border">
                                        <div className="text-2xl font-bold text-red-500">{broadcastProgress.failed}</div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <XCircle className="h-3 w-3" /> Failed
                                        </div>
                                    </div>
                                    <div className="bg-background rounded-lg p-3 text-center border">
                                        <div className="text-2xl font-bold text-muted-foreground">
                                            {broadcastProgress.total - broadcastProgress.sent - broadcastProgress.failed}
                                        </div>
                                        <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                            <Clock className="h-3 w-3" /> Pending
                                        </div>
                                    </div>
                                </div>

                                {broadcastProgress.status === "running" && broadcastProgress.current && (
                                    <div className="flex items-center gap-2 text-sm px-3 py-2 bg-muted/50 rounded-lg">
                                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                        <span className="text-muted-foreground">Now sending:</span>
                                        <span className="font-mono font-medium">{formatJid(broadcastProgress.current)}</span>
                                    </div>
                                )}

                                {broadcastProgress.status === "completed" &&
                                    broadcastProgress.errors &&
                                    broadcastProgress.errors.length > 0 && (
                                        <div className="space-y-2">
                                            <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                                                <XCircle className="h-4 w-4" /> Failed ({broadcastProgress.errors.length})
                                            </h4>
                                            <div className="max-h-40 overflow-y-auto bg-red-50 dark:bg-red-950/30 rounded-lg p-2 space-y-1">
                                                {broadcastProgress.errors.map((err, i) => (
                                                    <div
                                                        key={i}
                                                        className="flex justify-between items-center text-xs py-1 px-2 bg-background/60 rounded"
                                                    >
                                                        <span className="font-mono">{formatJid(err.jid)}</span>
                                                        <span className="text-red-500 truncate ml-2 max-w-[200px]">
                                                            {err.error}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}

            {activeTab === "history" && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="h-5 w-5" />
                            Broadcast History
                        </CardTitle>
                        <CardDescription>History of sent broadcasts, stored permanently.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {historyLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <p className="text-sm">Belum ada broadcast.</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {history.map((log) => (
                                    <div
                                        key={log.id}
                                        className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                                    >
                                        {/* Status icon */}
                                        <div className="shrink-0">
                                            {log.status === "completed" ? (
                                                log.failed === 0 ? (
                                                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                                                ) : (
                                                    <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                                )
                                            ) : (
                                                <Radio className="h-8 w-8 text-blue-500 animate-pulse" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium truncate">{log.message}</p>
                                                {log.message.startsWith("[Meta API]") && (
                                                    <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                                                        Meta API
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                <span className="flex items-center gap-1">
                                                    <CheckCircle2 className="h-3 w-3 text-green-500" /> {log.sent}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <XCircle className="h-3 w-3 text-red-500" /> {log.failed}
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* View button */}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="shrink-0"
                                            onClick={() => openDetail(log)}
                                        >
                                            <Eye className="h-4 w-4 mr-1" /> Detail
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Detail Modal */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {selectedLog?.status === "completed" ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                                <Radio className="h-5 w-5 text-blue-500 animate-pulse" />
                            )}
                            Broadcast Detail
                        </DialogTitle>
                    </DialogHeader>

                    {detailLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : selectedLog ? (
                        <div className="flex flex-col gap-4 overflow-hidden min-h-0">
                            {/* Summary */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-muted/30 rounded-lg p-3 text-center">
                                    <div className="text-xl font-bold text-green-600">{selectedLog.sent}</div>
                                    <div className="text-xs text-muted-foreground">Sent</div>
                                </div>
                                <div className="bg-muted/30 rounded-lg p-3 text-center">
                                    <div className="text-xl font-bold text-red-500">{selectedLog.failed}</div>
                                    <div className="text-xs text-muted-foreground">Failed</div>
                                </div>
                                <div className="bg-muted/30 rounded-lg p-3 text-center">
                                    <div className="text-xl font-bold">{selectedLog.total}</div>
                                    <div className="text-xs text-muted-foreground">Total</div>
                                </div>
                            </div>

                            {/* Message */}
                            <div className="bg-muted/30 rounded-lg p-3">
                                <p className="text-xs text-muted-foreground mb-1">Message:</p>
                                <p className="text-sm whitespace-pre-wrap break-words">{selectedLog.message}</p>
                            </div>

                            {/* Time */}
                            <div className="flex gap-4 text-xs text-muted-foreground">
                                <span>Started: {formatTime(selectedLog.startedAt)}</span>
                                {selectedLog.completedAt && (
                                    <span>Completed: {formatTime(selectedLog.completedAt)}</span>
                                )}
                            </div>

                            {/* Recipients list */}
                            {selectedLog.recipients && selectedLog.recipients.length > 0 && (
                                <div className="flex-1 overflow-y-auto min-h-0">
                                    <h4 className="text-sm font-semibold mb-2">
                                        Recipients ({selectedLog.recipients.length})
                                    </h4>
                                    <div className="space-y-1">
                                        {selectedLog.recipients.map((r) => (
                                            <div
                                                key={r.id}
                                                className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                    r.status === "sent"
                                                        ? "bg-green-500/5"
                                                        : r.status === "failed"
                                                        ? "bg-red-500/5"
                                                        : "bg-muted/30"
                                                }`}
                                            >
                                                <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span
                                                        className={`px-1.5 py-0.5 rounded font-medium ${
                                                            r.status === "sent"
                                                                ? "text-green-600 bg-green-500/10"
                                                                : r.status === "failed"
                                                                ? "text-red-500 bg-red-500/10"
                                                                : "text-muted-foreground bg-muted/50"
                                                        }`}
                                                    >
                                                        {r.status}
                                                    </span>
                                                    {r.error && (
                                                        <span
                                                            className="text-red-500 max-w-[200px] truncate"
                                                            title={r.error}
                                                        >
                                                            {r.error}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
