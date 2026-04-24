"use client";

import { MoonStar, SunMedium, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSysPulseStore } from "@/lib/store";
import { cn, getStatusColor, titleCaseWsStatus } from "@/lib/utils";
import { getStoredOrgName } from "@/lib/api";

export function Topbar() {
  const wsStatus = useSysPulseStore((state) => state.wsStatus);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [orgName, setOrgName] = useState("SysPulse Primary");

  useEffect(() => {
    setMounted(true);
    setOrgName(getStoredOrgName());
  }, []);

  const isDark = resolvedTheme !== "light";

  return (
    <header className="border-b border-white/6 px-4 py-4 sm:px-6 lg:px-10">
      <div className="panel-surface flex flex-col gap-4 rounded-[28px] border border-slate-800/80 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.26em] text-slate-500">Organization</p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-white">{orgName}</h2>
            <Badge
              variant="outline"
              className={cn("border px-2.5 py-1 text-xs", getStatusColor(wsStatus))}
            >
              <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-current" />
              {titleCaseWsStatus(wsStatus)}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start md:self-auto">
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
            <span className="mr-2 inline-flex align-middle">
              {wsStatus === "connected" ? (
                <Wifi className="h-4 w-4 text-emerald-300" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-300" />
              )}
            </span>
            Stream {titleCaseWsStatus(wsStatus)}
          </div>

          <Button
            variant="outline"
            size="icon"
            aria-label="Toggle color theme"
            onClick={() => setTheme(isDark ? "light" : "dark")}
          >
            {mounted && isDark ? (
              <SunMedium className="h-4 w-4 text-yellow-200" />
            ) : (
              <MoonStar className="h-4 w-4 text-blue-200" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
