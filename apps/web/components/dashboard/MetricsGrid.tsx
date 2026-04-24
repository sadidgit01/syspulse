"use client";

import { ChevronDown, Cpu, MemoryStick, Server } from "lucide-react";

import { MetricChart } from "@/components/dashboard/MetricChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Agent, MetricSnapshot } from "@/types";

export function MetricsGrid({
  agent,
  agents,
  onSelectAgent,
  selectedAgentId,
  snapshots
}: {
  agent: Agent | null;
  agents: Agent[];
  onSelectAgent: (agentId: string) => void;
  selectedAgentId: string | null;
  snapshots: MetricSnapshot[];
}) {
  const latest = snapshots.at(-1) ?? null;

  return (
    <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
      <Card className="panel-surface panel-hover grid-shell rounded-3xl border border-slate-800/80">
        <CardHeader className="pb-4">
          <CardTitle className="text-white">Focus agent</CardTitle>
          <CardDescription className="text-slate-400">
            Choose the node you want to follow in real time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="relative">
            <select
              className="h-13 w-full appearance-none rounded-2xl border border-white/8 bg-white/[0.03] px-4 pr-12 text-sm text-white outline-none transition focus:border-blue-400/40"
              value={selectedAgentId ?? ""}
              onChange={(event) => onSelectAgent(event.target.value)}
            >
              {agents.length === 0 ? <option value="">No agents available</option> : null}
              {agents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.hostname}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </div>

          {agent ? (
            <>
              <div className="rounded-[26px] border border-blue-500/16 bg-blue-500/[0.06] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-2xl font-semibold text-white">{agent.hostname}</p>
                    <p className="mt-2 text-sm text-slate-300">
                      {agent.os} · {agent.arch}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Last pulse {formatRelativeTime(agent.lastSeen)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                    <Server className="h-5 w-5 text-blue-200" />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryMetric
                  label="CPU"
                  value={latest ? `${latest.cpuPercent.toFixed(1)}%` : "--"}
                  icon={Cpu}
                />
                <SummaryMetric
                  label="Memory"
                  value={latest ? `${latest.memoryPercent.toFixed(1)}%` : "--"}
                  icon={MemoryStick}
                />
                <SummaryMetric
                  label="Disk"
                  value={latest ? `${latest.diskPercent.toFixed(1)}%` : "--"}
                  icon={Server}
                />
              </div>

              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm",
                  snapshots.length > 0
                    ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-100"
                    : "border-yellow-500/20 bg-yellow-500/8 text-yellow-100"
                )}
              >
                {snapshots.length > 0
                  ? `Streaming smoothly with ${snapshots.length} points buffered for this node.`
                  : "No metric snapshots received for this agent yet."}
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/8 px-4 py-8 text-sm text-slate-400">
              Select an agent once the API returns fleet data.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2 xl:[&>*:last-child]:col-span-2">
        <MetricChart
          title="CPU"
          description="Processor pressure over the live ring buffer"
          metricKey="cpuPercent"
          data={snapshots}
          color="#3b82f6"
        />
        <MetricChart
          title="Memory"
          description="Resident memory pressure in real time"
          metricKey="memoryPercent"
          data={snapshots}
          color="#22c55e"
        />
        <MetricChart
          title="Disk"
          description="Storage saturation and sustained write pressure"
          metricKey="diskPercent"
          data={snapshots}
          color="#a855f7"
        />
      </div>
    </section>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
