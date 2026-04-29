import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME } from "@/lib/auth";
import { getBackendBaseUrl } from "@/lib/server-config";

async function handleProxy(request: NextRequest, path: string[]) {
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const search = request.nextUrl.search || "";
  const backendUrl = `${getBackendBaseUrl()}/${path.join("/")}${search}`;
  const headers = new Headers();

  headers.set("Authorization", `Bearer ${accessToken}`);
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const method = request.method;
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.text();

  const response = await fetch(backendUrl, {
    method,
    headers,
    body,
    cache: "no-store"
  });

  const responseBody = await response.text();
  const responseHeaders = new Headers({
    "Content-Type": response.headers.get("content-type") ?? "application/json"
  });
  const traceId = response.headers.get("x-trace-id");
  if (traceId) {
    responseHeaders.set("X-Trace-ID", traceId);
  }

  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseHeaders
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return handleProxy(request, path);
}
