"use client";

import { Activity, BrainCircuit, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAnomalies } from "@/lib/api";
import { AnomalyStreamClient } from "@/lib/anomaly-stream";
import { useSysPulseStore } from "@/lib/store";
import { cn, formatCompactTimestamp } from "@/lib/utils";

const INITIAL_WINDOW_MS = 30 * 60 * 1000;

export function AnomalyFeed() {
  const anomalies = useSysPulseStore((state) => state.anomalies);
  const agents = useSysPulseStore((state) => state.agents);
  const setAnomalies = useSysPulseStore((state) => state.setAnomalies);
  const addAnomaly = useSysPulseStore((state) => state.addAnomaly);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveIds, setLiveIds] = useState<string[]>([]);
  const timeoutsRef = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadAnomalies = async () => {
      try {
        const from = new Date(Date.now() - INITIAL_WINDOW_MS).toISOString();
        const events = await listAnomalies({ from, minScore: 0 });
        if (!cancelled) {
          setAnomalies(events);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : "Unable to load anomaly events."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAnomalies();
    return () => {
      cancelled = true;
    };
  }, [setAnomalies]);

  useEffect(() => {
    const client = new AnomalyStreamClient({
      onAnomaly: (event) => {
        addAnomaly(event);
        setLiveIds((current) => [event.id, ...current.filter((id) => id !== event.id)].slice(0, 8));

        const timeoutId = window.setTimeout(() => {
          setLiveIds((current) => current.filter((id) => id !== event.id));
        }, 4_000);
        timeoutsRef.current.push(timeoutId);
      }
    });

    client.connect();

    return () => {
      client.disconnect();
      for (const timeoutId of timeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      timeoutsRef.current = [];
    };
  }, [addAnomaly]);

  const agentNames = useMemo(
    () =>
      Object.fromEntries(agents.map((agent) => [agent.id, agent.hostname])),
    [agents]
  );

  const visibleAnomalies = anomalies.slice(0, 10);

  return (
    <Card className="panel-surface panel-hover rounded-3xl border-slate-800/80">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">AI anomaly feed</p>
            <CardTitle className="mt-2 text-white">Live model-driven detections</CardTitle>
            <CardDescription className="mt-2 text-slate-400">
              Isolation Forest detections stream in live with the Groq explanation layer attached.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="border-blue-500/20 bg-blue-500/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-blue-100"
          >
            <Sparkles className="mr-1.5 h-3 w-3" />
            {visibleAnomalies.length} recent
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <FeedState icon={BrainCircuit} message="Loading anomaly feed..." />
        ) : error ? (
          <FeedState icon={Activity} message={error} danger />
        ) : visibleAnomalies.length === 0 ? (
          <FeedState
            icon={Sparkles}
            message="No anomalies have fired yet. The feed will wake up when the model flags a spike."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleAnomalies.map((event) => {
              const scoreTone = getScoreTone(event.score);
              const hostname = agentNames[event.agentId] ?? event.agentId.slice(0, 8);
              return (
                <article
                  key={event.id}
                  className={cn(
                    "rounded-[28px] border px-5 py-5 shadow-[0_18px_48px_rgba(2,6,23,0.26)] transition-transform duration-200 hover:-translate-y-0.5",
                    scoreTone.card,
                    liveIds.includes(event.id) && "anomaly-card-enter"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={cn("inline-flex h-2.5 w-2.5 rounded-full", scoreTone.dot)} />
                        <p className="text-sm font-semibold text-white">{hostname}</p>
                      </div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                        {humanizeReason(event.reason)}
                      </p>
                    </div>
                    <p className="text-xs text-slate-400">{formatCompactTimestamp(event.createdAt)}</p>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                      <span>Anomaly score</span>
                      <span className="text-white">{event.score.toFixed(2)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/6">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", scoreTone.bar)}
                        style={{ width: `${Math.max(8, Math.round(event.score * 100))}%` }}
                      />
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-200">
                    {event.explanation ?? "The AI layer has not produced an explanation yet."}
                  </p>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <SignalFact
                      label="CPU"
                      value={event.snapshot ? `${event.snapshot.cpuPercent.toFixed(0)}%` : "--"}
                    />
                    <SignalFact
                      label="Memory"
                      value={event.snapshot ? `${event.snapshot.memoryPercent.toFixed(0)}%` : "--"}
                    />
                    <SignalFact
                      label="Disk"
                      value={event.snapshot ? `${event.snapshot.diskPercent.toFixed(0)}%` : "--"}
                    />
                  </div>

                  <div className="mt-4 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
                    <ChevronRight className="h-3.5 w-3.5" />
                    Primary signal {readPrimaryMetric(event.details)}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeedState({
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
        "flex min-h-40 items-center justify-center gap-3 rounded-[28px] border px-6 text-sm",
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

function SignalFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function getScoreTone(score: number) {
  if (score > 0.75) {
    return {
      card: "border-red-500/20 bg-red-500/[0.08] shadow-[0_0_42px_rgba(239,68,68,0.12)]",
      dot: "bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]",
      bar: "bg-red-400"
    };
  }
  if (score >= 0.5) {
    return {
      card: "border-amber-500/20 bg-amber-500/[0.08] shadow-[0_0_42px_rgba(250,204,21,0.08)]",
      dot: "bg-amber-300 shadow-[0_0_18px_rgba(253,224,71,0.8)]",
      bar: "bg-amber-300"
    };
  }
  return {
    card: "border-emerald-500/20 bg-emerald-500/[0.08] shadow-[0_0_42px_rgba(34,197,94,0.08)]",
    dot: "bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]",
    bar: "bg-emerald-300"
  };
}

function humanizeReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

function readPrimaryMetric(details: Record<string, unknown>): string {
  const primaryMetric = details.primary_metric;
  if (typeof primaryMetric !== "string" || primaryMetric.length === 0) {
    return "model inference";
  }

  return primaryMetric.replace(/_/g, " ");
}
