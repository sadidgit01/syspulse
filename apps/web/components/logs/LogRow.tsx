"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn, formatCompactTimestamp, getLogLevelBadgeClasses } from "@/lib/utils";
import type { LogEntry } from "@/types";

export function LogRow({
  entry,
  agentName,
  expanded,
  highlighted,
  isNew,
  onToggle
}: {
  entry: LogEntry;
  agentName: string;
  expanded: boolean;
  highlighted?: boolean;
  isNew?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full rounded-[24px] border px-4 py-4 text-left transition-all",
        highlighted
          ? "border-red-500/24 bg-red-500/[0.08] shadow-[0_0_30px_rgba(239,68,68,0.08)]"
          : "border-white/6 bg-white/[0.03] hover:border-blue-500/20 hover:bg-blue-500/[0.04]",
        isNew && "log-row-enter"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border uppercase tracking-[0.18em]", getLogLevelBadgeClasses(entry.level))} variant="outline">
              {entry.level}
            </Badge>
            <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{agentName}</span>
            <span className="text-xs text-slate-500">{formatCompactTimestamp(entry.timestamp)}</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <p className="truncate text-sm font-medium text-slate-200">{entry.source}</p>
            <p className={cn("text-sm leading-6 text-slate-300", !expanded && "truncate")}>
              {entry.message}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-2 text-slate-400">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-4 border-t border-white/8 pt-4 sm:grid-cols-[1fr_auto]">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Full message</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-200">
              {entry.message}
            </pre>
          </div>
          <div className="space-y-2 rounded-2xl border border-white/8 bg-black/20 px-4 py-3 text-xs text-slate-400">
            <p>
              <span className="text-slate-500">Agent:</span> {agentName}
            </p>
            <p>
              <span className="text-slate-500">Source:</span> {entry.source}
            </p>
            <p>
              <span className="text-slate-500">Timestamp:</span> {entry.timestamp}
            </p>
            <p>
              <span className="text-slate-500">Log ID:</span> {entry.id}
            </p>
          </div>
        </div>
      ) : null}
    </button>
  );
}
