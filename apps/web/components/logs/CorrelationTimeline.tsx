"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, LoaderCircle, X } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCorrelation } from "@/lib/api";
import { cn, formatCompactTimestamp, getLogLevelBadgeClasses } from "@/lib/utils";
import type { Agent, CorrelationEvent, MetricCorrelationData } from "@/types";

const CORRELATION_WINDOW_MS = 6 * 60 * 60 * 1000;
const SPIKE_PROXIMITY_MS = 2 * 60 * 1000;

export function CorrelationTimeline({
  agent,
  open,
  onClose
}: {
  agent: Agent | null;
  open: boolean;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<CorrelationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    let cancelled = false;
    const loadCorrelation = async () => {
      setLoading(true);
      setError(null);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - CORRELATION_WINDOW_MS);
        const nextEvents = await getCorrelation(agent.id, from.toISOString(), to.toISOString());
        if (!cancelled) {
          setEvents(nextEvents);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load the correlation timeline."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadCorrelation();
    return () => {
      cancelled = true;
    };
  }, [agent, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  if (!open || !agent) {
    return null;
  }

  const metricEvents = events.filter((event): event is Extract<CorrelationEvent, { type: "metric" }> => event.type === "metric");
  const logEvents = events.filter((event): event is Extract<CorrelationEvent, { type: "log" }> => event.type === "log");
  const spikeTimestamps = findMetricSpikes(metricEvents);
  const chartData = metricEvents.map((event) => ({
    timestamp: event.timestamp,
    cpuPercent: event.data.cpuPercent
  }));

  return (
    <div className="fixed inset-0 z-50 flex bg-black/55 backdrop-blur-sm">
      <button type="button" className="flex-1" aria-label="Close correlation view" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#090b12] shadow-[-20px_0_80px_rgba(2,6,23,0.55)]">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b border-white/8 px-6 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Correlation</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{agent.hostname}</h3>
              <p className="mt-2 text-sm text-slate-400">
                CPU spikes and logs interleaved over the last six hours.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">CPU spike context</p>
                  <p className="text-xs text-slate-500">
                    Spikes fire when CPU exceeds 1.5x the rolling one-hour average.
                  </p>
                </div>
                <Badge variant="outline" className="border-red-500/20 bg-red-500/8 text-red-100">
                  {spikeTimestamps.length} spikes
                </Badge>
              </div>

              <div className="h-36">
                {loading ? (
                  <DrawerState icon={LoaderCircle} message="Loading correlation data..." />
                ) : error ? (
                  <DrawerState icon={AlertTriangle} message={error} danger />
                ) : chartData.length === 0 ? (
                  <DrawerState icon={Activity} message="No metrics available in this range." />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ left: -20, right: 10, top: 4, bottom: 0 }}>
                      <XAxis dataKey="timestamp" hide />
                      <YAxis hide domain={[0, 100]} />
                      <Tooltip
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "CPU"]}
                        labelFormatter={(label) => formatCompactTimestamp(String(label))}
                        contentStyle={{
                          borderRadius: "18px",
                          border: "1px solid rgba(148, 163, 184, 0.18)",
                          backgroundColor: "rgba(15, 23, 42, 0.92)"
                        }}
                      />
                      <Line
                        dataKey="cpuPercent"
                        type="monotone"
                        stroke="#3b82f6"
                        strokeWidth={2.4}
                        dot={false}
                        activeDot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {loading ? (
                <DrawerState icon={LoaderCircle} message="Building the interleaved timeline..." />
              ) : error ? (
                <DrawerState icon={AlertTriangle} message={error} danger />
              ) : events.length === 0 ? (
                <DrawerState icon={Activity} message="No correlated events were found." />
              ) : (
                events.map((event, index) => {
                  if (event.type === "metric") {
                    return (
                      <div
                        key={`${event.type}-${event.timestamp}-${index}`}
                        className="rounded-[24px] border border-blue-500/16 bg-blue-500/[0.05] px-4 py-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-medium text-white">Metric snapshot</p>
                            <p className="text-xs text-slate-500">{formatCompactTimestamp(event.timestamp)}</p>
                          </div>
                          <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-100" variant="outline">
                            CPU {event.data.cpuPercent.toFixed(1)}%
                          </Badge>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          <MetricFact label="Memory" value={`${event.data.memoryPercent.toFixed(1)}%`} />
                          <MetricFact label="Disk" value={`${event.data.diskPercent.toFixed(1)}%`} />
                          <MetricFact label="Net out" value={`${event.data.netBytesOut.toFixed(0)} B`} />
                        </div>
                      </div>
                    );
                  }

                  const coincidesWithSpike = spikeTimestamps.some(
                    (timestamp) =>
                      Math.abs(Date.parse(timestamp) - Date.parse(event.timestamp)) <= SPIKE_PROXIMITY_MS
                  );

                  return (
                    <div
                      key={`${event.type}-${event.data.id}-${index}`}
                      className={cn(
                        "rounded-[24px] border px-4 py-4",
                        coincidesWithSpike
                          ? "border-red-500/24 bg-red-500/[0.08] shadow-[0_0_30px_rgba(239,68,68,0.09)]"
                          : "border-white/8 bg-white/[0.03]"
                      )}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={cn("border uppercase tracking-[0.18em]", getLogLevelBadgeClasses(event.data.level))} variant="outline">
                              {event.data.level}
                            </Badge>
                            {coincidesWithSpike ? (
                              <Badge className="border-red-500/20 bg-red-500/10 text-red-100" variant="outline">
                                Spike window
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-3 text-sm font-medium text-white">{event.data.source}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{event.data.message}</p>
                        </div>
                        <p className="text-xs text-slate-500">{formatCompactTimestamp(event.timestamp)}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {logEvents.length === 0 && !loading && !error ? null : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function findMetricSpikes(events: Array<{ timestamp: string; data: MetricCorrelationData }>): string[] {
  const spikes: string[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index];
    const currentTime = Date.parse(current.timestamp);
    const oneHourWindow = events.filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return timestamp <= currentTime && currentTime - timestamp <= 60 * 60 * 1000;
    });

    const averageCpu =
      oneHourWindow.reduce((total, event) => total + event.data.cpuPercent, 0) /
      Math.max(oneHourWindow.length, 1);

    if (averageCpu > 0 && current.data.cpuPercent > averageCpu * 1.5) {
      spikes.push(current.timestamp);
    }
  }

  return spikes;
}

function MetricFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function DrawerState({
  icon: Icon,
  message,
  danger = false
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-28 items-center justify-center gap-3 rounded-[24px] border px-4 text-sm",
        danger
          ? "border-red-500/20 bg-red-500/8 text-red-200"
          : "border-white/8 bg-white/[0.03] text-slate-400"
      )}
    >
      <Icon className={cn("h-4 w-4", danger ? "text-red-200" : "text-blue-200")} />
      <span>{message}</span>
    </div>
  );
}
