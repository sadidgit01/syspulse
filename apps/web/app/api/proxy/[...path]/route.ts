import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME } from "@/lib/auth";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function handleProxy(request: NextRequest, path: string[]) {
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (!accessToken) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const search = request.nextUrl.search || "";
  const backendUrl = `${API_BASE_URL}/${path.join("/")}${search}`;
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
  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json"
    }
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
