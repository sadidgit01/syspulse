import { NextRequest, NextResponse } from "next/server";

import { applyAuthCookies, postToBackend } from "@/app/api/auth/_utils";
import type { RegisterBackendResponse } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { password: string; token: string };
    const backendResponse = await postToBackend<RegisterBackendResponse>(
      `/auth/accept-invite?token=${encodeURIComponent(body.token)}`,
      { password: body.password }
    );
    const response = NextResponse.json({ accepted: true });
    await applyAuthCookies(response, backendResponse);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to accept invite";
    return NextResponse.json({ detail: message }, { status: 400 });
  }
}
