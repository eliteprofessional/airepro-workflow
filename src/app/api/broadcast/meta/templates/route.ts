import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";

const DEFAULT_META_API_KEY = "wak_599875_41f4cd35e8593640262935b9ecfe623114b9d70a36e63443";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Unauthorized", error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const apiKey =
            searchParams.get("apiKey") ||
            request.headers.get("x-api-key") ||
            DEFAULT_META_API_KEY;

        const response = await fetch("https://whatsapp.airepro.in/api/v1/templates", {
            method: "GET",
            headers: {
                "x-api-key": apiKey.trim(),
                "Content-Type": "application/json"
            }
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || (data && data.success === false)) {
            const errorMsg =
                data?.error || data?.message || `Failed to fetch templates (HTTP ${response.status})`;
            return NextResponse.json(
                { status: false, message: errorMsg, error: errorMsg, details: data },
                { status: response.status >= 400 && response.status < 500 ? response.status : 400 }
            );
        }

        const templates = Array.isArray(data?.templates) ? data.templates : [];

        return NextResponse.json({
            status: true,
            success: true,
            count: templates.length,
            templates
        });
    } catch (e: any) {
        console.error("Meta templates route error:", e);
        return NextResponse.json(
            { status: false, message: e.message || "Failed to fetch templates", error: e.message },
            { status: 500 }
        );
    }
}
