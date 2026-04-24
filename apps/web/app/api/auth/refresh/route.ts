import { NextResponse } from "next/server";

import {
  applyAuthCookies,
  clearAuthCookies,
  getRefreshTokenFromCookies,
  postToBackend
} from "@/app/api/auth/_utils";
import type { AuthBackendResponse } from "@/types";

export async function POST() {
  const refreshToken = await getRefreshTokenFromCookies();
  if (!refreshToken) {
    const response = NextResponse.json({ detail: "Refresh token missing" }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  try {
    const backendResponse = await postToBackend<AuthBackendResponse>("/auth/refresh", {
      refresh_token: refreshToken
    });
    const response = NextResponse.json({ refreshed: true });
    await applyAuthCookies(response, backendResponse);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      { detail: error instanceof Error ? error.message : "Unable to refresh session" },
      { status: 401 }
    );
    clearAuthCookies(response);
    return response;
  }
}
