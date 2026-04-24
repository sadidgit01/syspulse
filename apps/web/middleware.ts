import { NextRequest, NextResponse } from "next/server";

import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/auth";

export function middleware(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE_NAME)?.value ?? null;
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value ?? null;

  if (!hasUsableToken(accessToken) && !hasUsableToken(refreshToken)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"]
};

function hasUsableToken(token: string | null): boolean {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return false;
  }

  try {
    const base64 = parts[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!base64) {
      return false;
    }
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
      exp?: number;
    };

    if (typeof decoded.exp !== "number") {
      return false;
    }

    return decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
