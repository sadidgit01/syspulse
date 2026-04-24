"use client";

import { AlertTriangle, Activity, ArrowUpRight, Cpu, Orbit, ShieldCheck, Waves } from "lucide-react";
import { useEffect, useState } from "react";

import { AnomalyFeed } from "@/components/ai/AnomalyFeed";
import { ForecastWarnings } from "@/components/ai/ForecastWarnings";
import { AgentHeatmap } from "@/components/dashboard/AgentHeatmap";
import { AgentStatusCard } from "@/components/dashboard/AgentStatusCard";
import { CorrelationTimeline } from "@/components/logs/CorrelationTimeline";
import { MetricsGrid } from "@/components/dashboard/MetricsGrid";
import { useSession } from "@/components/providers/session-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMetrics } from "@/hooks/useMetrics";
import { useWebSocket } from "@/hooks/useWebSocket";
import { listAgents } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import { cn, formatRelativeTime, formatThroughput } from "@/lib/utils";
import type { MetricSnapshot } from "@/types";

const alertRules = [
  {
    id: "cpu-warning",
    name: "CPU saturation watch",
    description: "Flags nodes above 60% sustained CPU load.",
    severity: "warning"
  },
  {
    id: "cpu-critical",
    name: "Critical thermal lane",
    description: "Escalates nodes above 85% CPU immediately.",
    severity: "critical"
  }
] as const;

export default function DashboardPage() {
  const session = useSession();
  const agents = useSysPulseStore((state) => state.agents);
  const metrics = useSysPulseStore((state) => state.metrics);
  const anomalies = useSysPulseStore((state) => state.anomalies);
  const setAgents = useSysPulseStore((state) => state.setAgents);
  const wsStatus = useWebSocket(session?.orgId ?? null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [correlationAgentId, setCorrelationAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const loadAgents = async () => {
      try {
        const response = await listAgents();
        if (!cancelled) {
          setAgents(response);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Unable to reach the SysPulse API.";
          setErrorMessage(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAgents();
    intervalId = window.setInterval(() => {
      void loadAgents();
    }, 30_000);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [setAgents]);

  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(agents[0]?.id ?? null);
      return;
    }

    if (selectedAgentId && !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0]?.id ?? null);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const correlationAgent = agents.find((agent) => agent.id === correlationAgentId) ?? null;
  const { snapshots: selectedAgentMetrics, latest: latestMetric } = useMetrics(selectedAgentId);
  const latestByAgent = agents.reduce<Record<string, MetricSnapshot | null>>((accumulator, agent) => {
    const series = metrics[agent.id] ?? [];
    accumulator[agent.id] = series.at(-1) ?? null;
    return accumulator;
  }, {});
  const latestAnomalyByAgent = anomalies.reduce<Record<string, (typeof anomalies)[number] | null>>(
    (accumulator, anomaly) => {
      const ageInMs = Date.now() - Date.parse(anomaly.createdAt);
      if (ageInMs > 10 * 60 * 1000) {
        return accumulator;
      }
      const current = accumulator[anomaly.agentId];
      if (!current || Date.parse(anomaly.createdAt) > Date.parse(current.createdAt)) {
        accumulator[anomaly.agentId] = anomaly;
      }
      return accumulator;
    },
    {}
  );

  const healthyAgents = agents.filter((agent) => agent.status === "alive").length;
  const hotAgents = agents.filter((agent) => {
    const latest = latestByAgent[agent.id];
    return latest !== null && latest.cpuPercent > 85;
  });
  const warningAgents = agents.filter((agent) => {
    const latest = latestByAgent[agent.id];
    return latest !== null && latest.cpuPercent >= 60 && latest.cpuPercent <= 85;
  });
  const aggregateCpu =
    agents.length === 0
      ? 0
      : agents.reduce((total, agent) => total + (latestByAgent[agent.id]?.cpuPercent ?? 0), 0) /
        agents.length;

  return (
    <div className="space-y-8">
      <section id="dashboard" className="space-y-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <Badge
              className="border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-blue-200"
              variant="outline"
            >
              Live Command Surface
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Monitor agent health, load spikes, and live telemetry in one pulse.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
                SysPulse streams metric snapshots straight into the dashboard, keeping the most
                recent sixty samples per node ready for instant triage and trend analysis.
              </p>
            </div>
          </div>

          <Card className="panel-surface panel-hover w-full max-w-xl rounded-3xl border-slate-800/80 xl:w-[420px]">
            <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Active Stream
                  </span>
                  <Orbit className="h-4 w-4 text-blue-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">{wsStatus}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {session?.orgId
                    ? `Connected to org ${session.orgId.slice(0, 8)}...`
                    : "Waiting for org context"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Avg CPU
                  </span>
                  <Cpu className="h-4 w-4 text-cyan-400" />
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {aggregateCpu.toFixed(1)}
                  <span className="ml-1 text-sm text-slate-400">%</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Across {agents.length || 0} monitored nodes
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <OverviewCard
            icon={ShieldCheck}
            label="Agents Healthy"
            value={`${healthyAgents}/${agents.length || 0}`}
            description="Nodes inside the 30-second freshness window."
            tone="green"
          />
          <OverviewCard
            icon={AlertTriangle}
            label="Critical Pressure"
            value={String(hotAgents.length)}
            description="Agents above 85% CPU and worth immediate review."
            tone="red"
          />
          <OverviewCard
            icon={Waves}
            label="Warm Watchlist"
            value={String(warningAgents.length)}
            description="Agents between 60% and 85% CPU pressure."
            tone="yellow"
          />
          <OverviewCard
            icon={Activity}
            label="Selected Throughput"
            value={
              latestMetric
                ? `${formatThroughput(latestMetric.netBytesIn)}/${formatThroughput(latestMetric.netBytesOut)}`
                : "--"
            }
            description="Current inbound and outbound traffic on the focus node."
            tone="blue"
          />
        </div>

        <ForecastWarnings />

        <MetricsGrid
          agent={selectedAgent}
          selectedAgentId={selectedAgentId}
          agents={agents}
          onSelectAgent={setSelectedAgentId}
          snapshots={selectedAgentMetrics}
        />
      </section>

      <section id="agents" className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Agents</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Fleet pulse map</h2>
          </div>
          <p className="max-w-xl text-right text-sm text-slate-400">
            Status cards and the heatmap below stay in lockstep with the in-memory metric ring
            buffer, so operational hotspots surface as soon as a snapshot lands.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentStatusCard
                key={agent.id}
                agent={agent}
                latestMetric={latestByAgent[agent.id]}
                latestAnomaly={latestAnomalyByAgent[agent.id] ?? null}
                isActive={agent.id === selectedAgentId}
                onSelect={setSelectedAgentId}
                onCorrelate={(nextAgent) => setCorrelationAgentId(nextAgent.id)}
              />
            ))}

            {!loading && agents.length === 0 ? (
              <Card className="panel-surface rounded-3xl border-dashed border-slate-800/80 md:col-span-2 xl:col-span-2 2xl:col-span-3">
                <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-lg font-medium text-white">No agents are visible yet.</p>
                  <p className="max-w-md text-sm text-slate-400">
                    Register an agent against your organization token and the fleet will populate
                    automatically as soon as metrics begin streaming.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <AgentHeatmap agents={agents} latestMetrics={latestByAgent} />
        </div>
      </section>

      <section id="logs" className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-white">Recent activity lane</CardTitle>
            <CardDescription className="text-slate-400">
              A quick read on which nodes have reported in most recently.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {agents
              .slice()
              .sort((left, right) => Date.parse(right.lastSeen) - Date.parse(left.lastSeen))
              .slice(0, 6)
              .map((agent) => {
                const latest = latestByAgent[agent.id];
                return (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-white">{agent.hostname}</p>
                      <p className="text-xs text-slate-400">
                        Last heartbeat {formatRelativeTime(agent.lastSeen)}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-300">
                      <p>CPU {latest ? `${latest.cpuPercent.toFixed(1)}%` : "--"}</p>
                      <p className="text-slate-500">
                        Net {latest ? formatThroughput(latest.netBytesOut) : "--"}
                      </p>
                    </div>
                  </div>
                );
              })}

            {!loading && agents.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/8 px-4 py-5 text-sm text-slate-400">
                No activity yet because no agents have registered or the API token is missing.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-white">Transport status</CardTitle>
            <CardDescription className="text-slate-400">
              Live delivery posture for the websocket and fetch layers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TransportRow label="WebSocket stream" value={wsStatus} highlight />
            <TransportRow label="Agent cache" value={`${agents.length} nodes`} />
            <TransportRow
              label="Metric buffers"
              value={`${Object.keys(metrics).length} active`}
            />
            <TransportRow
              label="API sync"
              value={errorMessage ? "degraded" : loading ? "warming" : "healthy"}
            />
            {errorMessage ? (
              <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                {errorMessage}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section id="ai" className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">AI layer</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Model output in real time</h2>
          </div>
          <p className="max-w-xl text-right text-sm text-slate-400">
            Anomaly events and their explanations stream into the same dashboard surface so operators
            can react without leaving the live metrics view.
          </p>
        </div>

        <AnomalyFeed />
      </section>

      <section id="alerts" className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-white">Alert posture</CardTitle>
            <CardDescription className="text-slate-400">
              Rules currently applied to CPU saturation in the live grid.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertRules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{rule.name}</p>
                  <Badge
                    className={cn(
                      "border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em]",
                      rule.severity === "critical"
                        ? "border-red-500/30 bg-red-500/10 text-red-200"
                        : "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"
                    )}
                    variant="outline"
                  >
                    {rule.severity}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-400">{rule.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
          <CardHeader className="pb-4">
            <CardTitle className="text-white">Stress watchlist</CardTitle>
            <CardDescription className="text-slate-400">
              Agents currently tripping the most aggressive CPU thresholds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hotAgents.length > 0 ? (
              hotAgents.map((agent) => {
                const latest = latestByAgent[agent.id];
                return (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium text-white">{agent.hostname}</p>
                      <p className="text-xs text-red-100/80">
                        Last seen {formatRelativeTime(agent.lastSeen)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-red-100">
                      <span className="text-lg font-semibold">
                        {latest?.cpuPercent.toFixed(1) ?? "--"}%
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-6">
                <p className="font-medium text-emerald-100">No critical CPU alerts right now.</p>
                <p className="mt-1 text-sm text-emerald-100/80">
                  Your fleet is operating inside the safe thermal lane.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <CorrelationTimeline
        agent={correlationAgent}
        open={correlationAgent !== null}
        onClose={() => setCorrelationAgentId(null)}
      />
    </div>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  description,
  tone
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
  tone: "green" | "yellow" | "red" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-100"
      : tone === "yellow"
        ? "border-yellow-500/20 bg-yellow-500/8 text-yellow-100"
        : tone === "red"
          ? "border-red-500/20 bg-red-500/8 text-red-100"
          : "border-blue-500/20 bg-blue-500/10 text-blue-100";

  return (
    <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="text-3xl font-semibold text-white">{value}</p>
            <p className="max-w-xs text-sm leading-6 text-slate-400">{description}</p>
          </div>
          <div className={cn("rounded-2xl border p-3", toneClass)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TransportRow({
  label,
  value,
  highlight = false
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-2xl border px-4 py-3 text-sm",
        highlight
          ? "border-blue-500/20 bg-blue-500/8 text-blue-100"
          : "border-white/6 bg-white/[0.03] text-slate-300"
      )}
    >
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}
