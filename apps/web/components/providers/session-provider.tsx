"use client";

import { createContext, useContext } from "react";

import type { AuthSession } from "@/lib/auth";

const SessionContext = createContext<AuthSession | null>(null);

export function SessionProvider({
  session,
  children
}: Readonly<{
  session: AuthSession | null;
  children: React.ReactNode;
}>) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
