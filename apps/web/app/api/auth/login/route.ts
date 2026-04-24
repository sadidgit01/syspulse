import { NextRequest, NextResponse } from "next/server";

import { applyAuthCookies, postToBackend } from "@/app/api/auth/_utils";
import type { LoginBackendResponse } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email: string; password: string };
    const backendResponse = await postToBackend<LoginBackendResponse>("/auth/login", body);
    const response = NextResponse.json({
      user: backendResponse.user
    });
    await applyAuthCookies(response, backendResponse);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid credentials";
    return NextResponse.json({ detail: message }, { status: 401 });
  }
}
