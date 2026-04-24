import { NextRequest, NextResponse } from "next/server";

import { applyAuthCookies, postToBackend } from "@/app/api/auth/_utils";
import type { RegisterBackendResponse } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email: string;
      password: string;
      org_name: string;
    };
    const backendResponse = await postToBackend<RegisterBackendResponse>("/auth/register", body);
    const response = NextResponse.json({
      user_id: backendResponse.user_id,
      org_id: backendResponse.org_id
    });
    await applyAuthCookies(response, backendResponse);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account";
    const status = message.toLowerCase().includes("exists") ? 409 : 400;
    return NextResponse.json({ detail: message }, { status });
  }
}
