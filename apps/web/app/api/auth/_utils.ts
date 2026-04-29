import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  SESSION_EMAIL_COOKIE_NAME,
  SESSION_ORG_ID_COOKIE_NAME,
  SESSION_ORG_NAME_COOKIE_NAME,
  SESSION_ROLE_COOKIE_NAME
} from "@/lib/auth";
import { getBackendBaseUrl } from "@/lib/server-config";
import type { AuthBackendResponse, MeBackendResponse } from "@/types";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export async function postToBackend<TResponse>(
  path: string,
  body: Record<string, unknown> | undefined
): Promise<TResponse> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await extractErrorMessage(response);
    throw new Error(detail);
  }

  return (await response.json()) as TResponse;
}

export async function fetchMe(accessToken: string): Promise<MeBackendResponse> {
  const response = await fetch(`${getBackendBaseUrl()}/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await extractErrorMessage(response);
    throw new Error(detail);
  }

  return (await response.json()) as MeBackendResponse;
}

export async function applyAuthCookies(
  response: NextResponse,
  authPayload: AuthBackendResponse
) {
  const profile = await fetchMe(authPayload.access_token);
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: authPayload.access_token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 15
  });
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: authPayload.refresh_token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });
  response.cookies.set({
    name: SESSION_EMAIL_COOKIE_NAME,
    value: profile.user.email,
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });
  response.cookies.set({
    name: SESSION_ROLE_COOKIE_NAME,
    value: profile.role,
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });
  response.cookies.set({
    name: SESSION_ORG_ID_COOKIE_NAME,
    value: profile.organization.org_id,
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });
  response.cookies.set({
    name: SESSION_ORG_NAME_COOKIE_NAME,
    value: profile.organization.name,
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE
  });
}

export function clearAuthCookies(response: NextResponse) {
  for (const cookieName of [
    ACCESS_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    SESSION_EMAIL_COOKIE_NAME,
    SESSION_ROLE_COOKIE_NAME,
    SESSION_ORG_ID_COOKIE_NAME,
    SESSION_ORG_NAME_COOKIE_NAME
  ]) {
    response.cookies.set({
      name: cookieName,
      value: "",
      path: "/",
      expires: new Date(0)
    });
  }
}

export async function getRefreshTokenFromCookies() {
  return (await cookies()).get(REFRESH_COOKIE_NAME)?.value ?? null;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    return response.statusText || "Request failed.";
  }

  return response.statusText || "Request failed.";
}
