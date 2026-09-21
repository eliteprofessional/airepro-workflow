"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
    Workflow as WorkflowIcon,
    Plus,
    Trash2,
    Pencil,
    Loader2,
    Zap,
    GitBranch,
    Clock,
    Globe,
} from "lucide-react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { getWorkflows, deleteWorkflow, toggleWorkflow } from "./actions";

interface WorkflowItem {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    triggerType: string;
    triggerValue: string | null;
    audience: string;
    nodes: any[];
    createdAt: string;
    updatedAt: string;
}

const triggerLabels: Record<string, string> = {
    KEYWORD: "Exact Keyword",
    CONTAINS: "Contains",
    REGEX: "Regex Pattern",
    ALL_MESSAGES: "All Messages",
};

const audienceLabels: Record<string, string> = {
    ALL: "Everyone",
    PRIVATE: "Private Only",
    GROUP: "Groups Only",
};

export default function WorkflowsPage() {
    const { sessionId } = useSession();
    const router = useRouter();
    const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (sessionId) fetchWorkflows();
    }, [sessionId]);

    const fetchWorkflows = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const data = await getWorkflows(sessionId);
            setWorkflows(data as unknown as WorkflowItem[]);
        } catch (error: any) {
            toast.error(error.message || "Error fetching workflows");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!sessionId) return;
        try {
            await deleteWorkflow(sessionId, id);
            toast.success("Workflow deleted");
            fetchWorkflows();
        } catch (error: any) {
            toast.error(error.message || "Error deleting workflow");
        }
    };

    const handleToggle = async (id: string) => {
        if (!sessionId) return;
        try {
            await toggleWorkflow(sessionId, id);
            setWorkflows((prev) =>
                prev.map((w) => (w.id === id ? { ...w, isActive: !w.isActive } : w))
            );
            toast.success("Workflow updated");
        } catch (error: any) {
            toast.error(error.message || "Error toggling workflow");
        }
    };

    return (
        <SessionGuard>
            <div className="max-w-6xl space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <GitBranch className="w-6 h-6 text-primary" />
                            Workflow Builder
                        </h1>
                        <p className="text-muted-foreground">
                            Create visual node-based workflows for dynamic auto-replies.
                        </p>
                    </div>
                    <Button onClick={() => router.push("/dashboard/workflows/builder")}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Workflow
                    </Button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center p-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : workflows.length === 0 ? (
                    <Card className="border-dashed shadow-none bg-muted/30">
                        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                                <WorkflowIcon className="w-8 h-8 text-primary" />
                            </div>
                            <h3 className="text-lg font-semibold">No workflows yet</h3>
                            <p className="text-muted-foreground mb-6 max-w-md">
                                Build dynamic auto-reply flows with triggers, conditions, delays, and more using a visual node editor.
                            </p>
                            <Button onClick={() => router.push("/dashboard/workflows/builder")}>
                                <Plus className="w-4 h-4 mr-2" />
                                Create your first workflow
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {workflows.map((wf) => (
                            <Card
                                key={wf.id}
                                className={`flex flex-col h-full transition-all duration-200 hover:shadow-md ${
                                    !wf.isActive ? "opacity-60" : ""
                                }`}
                            >
                                <CardHeader className="pb-3 border-b">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1 pr-2 min-w-0">
                                            <CardTitle className="text-base truncate">{wf.name}</CardTitle>
                                            {wf.description && (
                                                <p className="text-xs text-muted-foreground line-clamp-2">{wf.description}</p>
                                            )}
                                        </div>
                                        <Switch
                                            checked={wf.isActive}
                                            onCheckedChange={() => handleToggle(wf.id)}
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-4 flex-grow flex flex-col gap-3">
                                    <div className="flex flex-wrap gap-2">
                                        <Badge variant="outline" className="text-xs gap-1">
                                            <Zap className="w-3 h-3" />
                                            {triggerLabels[wf.triggerType] || wf.triggerType}
                                        </Badge>
                                        {wf.triggerValue && (
                                            <Badge variant="secondary" className="text-xs font-mono">
                                                {wf.triggerValue}
                                            </Badge>
                                        )}
                                        <Badge variant="outline" className="text-xs gap-1">
                                            <Globe className="w-3 h-3" />
                                            {audienceLabels[wf.audience] || wf.audience}
                                        </Badge>
                                    </div>

                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <GitBranch className="w-3 h-3" />
                                        {Array.isArray(wf.nodes) ? wf.nodes.length : 0} nodes
                                        <span className="mx-1">·</span>
                                        <Clock className="w-3 h-3" />
                                        {new Date(wf.updatedAt).toLocaleDateString()}
                                    </div>

                                    <div className="flex gap-2 mt-auto pt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1"
                                            onClick={() => router.push(`/dashboard/workflows/builder?id=${wf.id}`)}
                                        >
                                            <Pencil className="w-3 h-3 mr-1" />
                                            Edit
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Delete Workflow?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Are you sure you want to delete <strong>{wf.name}</strong>? This action cannot be undone.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction
                                                        onClick={() => handleDelete(wf.id)}
                                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                    >
                                                        Delete
                                                    </AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </SessionGuard>
    );
}
