import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME } from "@/lib/auth";
import { getBackendBaseUrl } from "@/lib/server-config";

export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const response = await fetch(
    `${getBackendBaseUrl()}/incidents/stream?token=${encodeURIComponent(accessToken)}`,
    {
      headers: {
        Accept: "text/event-stream"
      },
      cache: "no-store"
    }
  );

  if (!response.ok || !response.body) {
    const text = await response.text();
    return new NextResponse(text || "Unable to open incident stream.", {
      status: response.status || 502,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "text/plain"
      }
    });
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    }
  });
}
