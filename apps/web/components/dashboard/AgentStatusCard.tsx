"use client";

import { Cpu, HardDrive, MemoryStick, SignalHigh } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn, formatRelativeTime, getAgentToneClasses } from "@/lib/utils";
import type { Agent, MetricSnapshot } from "@/types";

export function AgentStatusCard({
  agent,
  latestMetric,
  isActive,
  onSelect
}: {
  agent: Agent;
  latestMetric: MetricSnapshot | null;
  isActive: boolean;
  onSelect: (agentId: string) => void;
}) {
  const toneClasses = getAgentToneClasses(agent.lastSeen);

  return (
    <button className="text-left" onClick={() => onSelect(agent.id)} type="button">
      <Card
        className={cn(
          "panel-surface panel-hover h-full rounded-3xl border p-0",
          isActive ? "border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.16)]" : "border-slate-800/80"
        )}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-white">{agent.hostname}</p>
              <p className="mt-1 text-sm text-slate-400">
                {agent.os} · {agent.arch}
              </p>
            </div>

            <Badge className={cn("border px-2.5 py-1 uppercase tracking-[0.18em]", toneClasses.badge)} variant="outline">
              {toneClasses.label}
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetricTile icon={Cpu} label="CPU" value={latestMetric ? `${latestMetric.cpuPercent.toFixed(0)}%` : "--"} />
            <MetricTile
              icon={MemoryStick}
              label="Memory"
              value={latestMetric ? `${latestMetric.memoryPercent.toFixed(0)}%` : "--"}
            />
            <MetricTile
              icon={HardDrive}
              label="Disk"
              value={latestMetric ? `${latestMetric.diskPercent.toFixed(0)}%` : "--"}
            />
            <MetricTile icon={SignalHigh} label="Last seen" value={formatRelativeTime(agent.lastSeen)} />
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
