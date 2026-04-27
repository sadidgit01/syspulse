import type { UserRole } from "@/types";

export const ACCESS_COOKIE_NAME = "syspulse_access_token";
export const REFRESH_COOKIE_NAME = "syspulse_refresh_token";
export const SESSION_EMAIL_COOKIE_NAME = "syspulse_user_email";
export const SESSION_ROLE_COOKIE_NAME = "syspulse_user_role";
export const SESSION_ORG_ID_COOKIE_NAME = "syspulse_org_id";
export const SESSION_ORG_NAME_COOKIE_NAME = "syspulse_org_name";

export interface AuthSession {
  email: string;
  role: UserRole;
  orgId: string;
  orgName: string;
}

export async function getAccessToken(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(ACCESS_COOKIE_NAME)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(REFRESH_COOKIE_NAME)?.value ?? null;
}

export async function getAuthSession(): Promise<AuthSession | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const email = cookieStore.get(SESSION_EMAIL_COOKIE_NAME)?.value ?? null;
  const role = cookieStore.get(SESSION_ROLE_COOKIE_NAME)?.value ?? null;
  const orgId = cookieStore.get(SESSION_ORG_ID_COOKIE_NAME)?.value ?? null;
  const orgName = cookieStore.get(SESSION_ORG_NAME_COOKIE_NAME)?.value ?? null;

  if (!email || !role || !orgId || !orgName) {
    return null;
  }

  if (!isUserRole(role)) {
    return null;
  }

  return {
    email,
    role,
    orgId,
    orgName
  };
}

export async function refreshAccessToken(): Promise<boolean> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include"
  });

  return response.ok;
}

export async function logout(options?: { redirectTo?: string }): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include"
  });

  if (typeof window !== "undefined") {
    window.location.assign(options?.redirectTo ?? "/login");
  }
}

function isUserRole(value: string): value is UserRole {
  return value === "admin" || value === "viewer" || value === "alert_manager";
}
