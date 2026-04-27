import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME } from "@/lib/auth";

import { fetchJaegerTraceList } from "./_jaeger";

export async function GET(request: NextRequest) {
  if (!request.cookies.get(ACCESS_COOKIE_NAME)?.value) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  try {
    const traces = await fetchJaegerTraceList(request.nextUrl.searchParams);
    return NextResponse.json(traces);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to load traces.";
    return NextResponse.json({ detail }, { status: 502 });
  }
}
