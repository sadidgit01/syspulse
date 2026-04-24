"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, getCpuHeatClasses } from "@/lib/utils";
import type { Agent, MetricSnapshot } from "@/types";

export function AgentHeatmap({
  agents,
  latestMetrics
}: {
  agents: Agent[];
  latestMetrics: Record<string, MetricSnapshot | null>;
}) {
  return (
    <Card className="panel-surface panel-hover rounded-3xl border border-slate-800/80">
      <CardHeader className="pb-4">
        <CardTitle className="text-white">CPU heatmap</CardTitle>
        <CardDescription className="text-slate-400">
          Fast scan view of the fleet by current CPU stress level.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {agents.map((agent) => {
            const latest = latestMetrics[agent.id];
            const classes = getCpuHeatClasses(latest?.cpuPercent ?? 0);

            return (
              <div
                key={agent.id}
                className={cn(
                  "rounded-2xl border px-3 py-4 transition-transform hover:-translate-y-0.5",
                  classes
                )}
              >
                <p className="truncate text-sm font-medium text-white">{agent.hostname}</p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {latest ? `${latest.cpuPercent.toFixed(0)}%` : "--"}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/70">
                  CPU load
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
