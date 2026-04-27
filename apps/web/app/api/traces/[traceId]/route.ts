import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME } from "@/lib/auth";

import { fetchJaegerTraceDetail } from "../_jaeger";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ traceId: string }> }
) {
  if (!request.cookies.get(ACCESS_COOKIE_NAME)?.value) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const { traceId } = await context.params;
  try {
    const trace = await fetchJaegerTraceDetail(traceId);
    return NextResponse.json(trace);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to load trace.";
    return NextResponse.json({ detail }, { status: 502 });
  }
}
