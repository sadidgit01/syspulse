"use client";

import { AlertTriangle, BrainCircuit, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCorrelation } from "@/lib/api";
import { cn, formatCompactTimestamp, getLogLevelBadgeClasses } from "@/lib/utils";
import type { Agent, AnomalyEvent, CorrelationEvent } from "@/types";

const MODAL_WINDOW_MS = 10 * 60 * 1000;
const CORRELATED_LOG_WINDOW_MS = 2 * 60 * 1000;

export function AnomalyDetailModal({
  agent,
  anomaly,
  open,
  onClose
}: {
  agent: Agent;
  anomaly: AnomalyEvent | null;
  open: boolean;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<CorrelationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !anomaly) {
      return;
    }

    let cancelled = false;
    const loadCorrelation = async () => {
      setLoading(true);
      setError(null);
      try {
        const center = Date.parse(anomaly.createdAt);
        const from = new Date(center - MODAL_WINDOW_MS).toISOString();
        const to = new Date(center + MODAL_WINDOW_MS).toISOString();
        const nextEvents = await getCorrelation(agent.id, from, to);
        if (!cancelled) {
          setEvents(nextEvents);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to load anomaly detail context."
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
  }, [agent.id, anomaly, open]);

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

  const metricEvents = useMemo(
    () =>
      events.filter(
        (event): event is Extract<CorrelationEvent, { type: "metric" }> => event.type === "metric"
      ),
    [events]
  );
  const correlatedLogs = useMemo(() => {
    if (!anomaly) {
      return [];
    }
    const anomalyTime = Date.parse(anomaly.createdAt);
    return events.filter((event): event is Extract<CorrelationEvent, { type: "log" }> => {
      if (event.type !== "log") {
        return false;
      }
      return Math.abs(Date.parse(event.timestamp) - anomalyTime) <= CORRELATED_LOG_WINDOW_MS;
    });
  }, [anomaly, events]);

  const chartData = useMemo(() => {
    if (metricEvents.length > 0) {
      return metricEvents.map((event) => ({
        timestamp: event.timestamp,
        cpuPercent: event.data.cpuPercent,
        memoryPercent: event.data.memoryPercent,
        diskPercent: event.data.diskPercent
      }));
    }

    if (!anomaly?.snapshot) {
      return [];
    }

    return [
      {
        timestamp: anomaly.snapshot.timestamp,
        cpuPercent: anomaly.snapshot.cpuPercent,
        memoryPercent: anomaly.snapshot.memoryPercent,
        diskPercent: anomaly.snapshot.diskPercent
      }
    ];
  }, [anomaly?.snapshot, metricEvents]);

  if (!open || !anomaly) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/58 backdrop-blur-sm">
      <button type="button" className="flex-1" aria-label="Close anomaly detail" onClick={onClose} />
      <div className="relative h-full w-full max-w-2xl border-l border-white/10 bg-[#090b12] shadow-[-20px_0_80px_rgba(2,6,23,0.55)]">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between border-b border-white/8 px-6 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Anomaly detail</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{agent.hostname}</h3>
              <p className="mt-2 text-sm text-slate-400">
                {humanizeReason(anomaly.reason)} detected at {formatCompactTimestamp(anomaly.createdAt)}.
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <section className="rounded-[28px] border border-red-500/20 bg-red-500/[0.08] p-5 shadow-[0_0_44px_rgba(239,68,68,0.1)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-400" />
                    <p className="text-sm uppercase tracking-[0.18em] text-red-100/80">Active anomaly window</p>
                  </div>
                  <h4 className="text-2xl font-semibold text-white">{anomaly.score.toFixed(2)}</h4>
                </div>
                <Badge variant="outline" className="border-red-500/20 bg-red-500/10 text-red-100">
                  {humanizeReason(anomaly.reason)}
                </Badge>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/6">
                <div
                  className="h-full rounded-full bg-red-400"
                  style={{ width: `${Math.max(8, Math.round(anomaly.score * 100))}%` }}
                />
              </div>

              <p className="mt-4 text-sm leading-6 text-slate-100">
                {anomaly.explanation ?? "The explanation layer has not responded for this event yet."}
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <InfoFact label="Primary signal" value={readPrimaryMetric(anomaly.details)} />
                <InfoFact
                  label="CPU"
                  value={anomaly.snapshot ? `${anomaly.snapshot.cpuPercent.toFixed(0)}%` : "--"}
                />
                <InfoFact
                  label="Memory"
                  value={anomaly.snapshot ? `${anomaly.snapshot.memoryPercent.toFixed(0)}%` : "--"}
                />
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
              <div className="mb-4">
                <h4 className="text-lg font-semibold text-white">Spike context</h4>
                <p className="mt-1 text-sm text-slate-400">
                  CPU, memory, and disk around the anomaly window.
                </p>
              </div>

              <div className="h-56">
                {loading ? (
                  <ModalState icon={LoaderCircle} message="Loading anomaly context..." />
                ) : error ? (
                  <ModalState icon={AlertTriangle} message={error} danger />
                ) : chartData.length === 0 ? (
                  <ModalState
                    icon={BrainCircuit}
                    message="No nearby metric context was returned for this anomaly."
                  />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ left: -18, right: 8, top: 4, bottom: 0 }}>
                      <XAxis dataKey="timestamp" hide />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${value.toFixed(1)}%`,
                          name.replace("Percent", "")
                        ]}
                        labelFormatter={(value: string) => formatCompactTimestamp(value)}
                        contentStyle={{
                          borderRadius: "18px",
                          border: "1px solid rgba(148, 163, 184, 0.18)",
                          backgroundColor: "rgba(15, 23, 42, 0.94)"
                        }}
                      />
                      <Line type="monotone" dataKey="cpuPercent" stroke="#ef4444" strokeWidth={2.4} dot={false} />
                      <Line
                        type="monotone"
                        dataKey="memoryPercent"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="diskPercent"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-semibold text-white">Correlated logs</h4>
                  <p className="mt-1 text-sm text-slate-400">
                    Entries inside the two-minute window around the anomaly event.
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="border-blue-500/20 bg-blue-500/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-blue-100"
                >
                  {correlatedLogs.length} found
                </Badge>
              </div>

              {loading ? (
                <ModalState icon={LoaderCircle} message="Cross-checking nearby logs..." />
              ) : correlatedLogs.length === 0 ? (
                <ModalState
                  icon={BrainCircuit}
                  message="No correlated logs were found close to this anomaly window."
                />
              ) : (
                <div className="space-y-3">
                  {correlatedLogs.map((event) => (
                    <div
                      key={`${event.data.id}-${event.timestamp}`}
                      className="rounded-[24px] border border-red-500/16 bg-red-500/[0.06] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn("border uppercase tracking-[0.18em]", getLogLevelBadgeClasses(event.data.level))}
                            >
                              {event.data.level}
                            </Badge>
                            <span className="text-xs text-slate-500">{event.data.source}</span>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-200">{event.data.message}</p>
                        </div>
                        <p className="text-xs text-slate-500">{formatCompactTimestamp(event.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function ModalState({
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
        "flex min-h-32 items-center justify-center gap-3 rounded-[24px] border px-4 text-sm",
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

function readPrimaryMetric(details: Record<string, unknown>): string {
  const primaryMetric = details.primary_metric;
  if (typeof primaryMetric !== "string" || primaryMetric.length === 0) {
    return "model inference";
  }

  return primaryMetric.replace(/_/g, " ");
}

function humanizeReason(reason: string): string {
  return reason.replace(/_/g, " ");
}
