"use client";

import { BellRing, LayoutDashboard, ScrollText, Server } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navigationItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard#agents", label: "Agents", icon: Server },
  { href: "/dashboard#logs", label: "Logs", icon: ScrollText },
  { href: "/dashboard#alerts", label: "Alerts", icon: BellRing }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-b border-white/6 px-4 py-4 lg:border-b-0 lg:border-r lg:border-white/6 lg:px-6 lg:py-8">
      <div className="panel-surface grid-shell flex h-full flex-col rounded-[28px] border border-slate-800/80 p-5">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/12 shadow-[0_0_28px_rgba(59,130,246,0.16)]">
            <span className="text-lg font-semibold text-blue-200">SP</span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">SysPulse</p>
            <p className="text-lg font-semibold text-white">Command Deck</p>
          </div>
        </div>

        <nav className="space-y-2">
          {navigationItems.map(({ href, label, icon: Icon }) => {
            const isActive = href === "/dashboard" && pathname === "/dashboard";

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition-all",
                  isActive
                    ? "border-blue-500/30 bg-blue-500/12 text-white shadow-[0_0_26px_rgba(59,130,246,0.12)]"
                    : "border-transparent bg-transparent text-slate-400 hover:border-white/8 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                    isActive
                      ? "bg-blue-500/16 text-blue-200"
                      : "bg-white/[0.03] text-slate-500 group-hover:text-slate-200"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-3xl border border-white/6 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Streaming</p>
          <p className="mt-3 text-lg font-semibold text-white">60-sample ring buffer</p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Every agent keeps its freshest sixty snapshots warm in memory for instant chart redraws
            and hover-free triage.
          </p>
        </div>
      </div>
    </aside>
  );
}
