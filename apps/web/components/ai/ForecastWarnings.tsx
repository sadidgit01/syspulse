"use client";

import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listForecasts } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import { formatCompactTimestamp } from "@/lib/utils";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function ForecastWarnings() {
  const agents = useSysPulseStore((state) => state.agents);
  const forecasts = useSysPulseStore((state) => state.forecasts);
  const setForecasts = useSysPulseStore((state) => state.setForecasts);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const loadForecasts = async () => {
      try {
        const nextForecasts = await listForecasts();
        if (!cancelled) {
          setForecasts(nextForecasts);
          setError(null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : "Unable to load forecast alerts."
          );
        }
      }
    };

    void loadForecasts();
    intervalId = window.setInterval(() => {
      void loadForecasts();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [setForecasts]);

  const agentNames = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent.hostname])),
    [agents]
  );

  const warningForecasts = forecasts.filter(
    (forecast) =>
      forecast.exceedInHours !== null &&
      forecast.predictedValue >= 90 &&
      !dismissedIds.includes(forecast.id)
  );

  if (warningForecasts.length === 0 && !error) {
    return null;
  }

  return (
    <section className="space-y-3">
      {error ? (
        <Card className="panel-surface rounded-[28px] border-red-500/20 bg-red-500/[0.08]">
          <CardContent className="px-5 py-4 text-sm text-red-100">{error}</CardContent>
        </Card>
      ) : null}

      {warningForecasts.map((forecast) => {
        const expanded = expandedId === forecast.id;
        const hostname = agentNames[forecast.agentId] ?? forecast.agentId.slice(0, 8);
        const chartData = buildForecastSeries(forecast.forecastPoints);

        return (
          <Card
            key={forecast.id}
            className="panel-surface rounded-[30px] border-amber-500/20 bg-amber-500/[0.08] shadow-[0_0_44px_rgba(245,158,11,0.08)]"
          >
            <CardContent className="px-5 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => setExpandedId(expanded ? null : forecast.id)}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-300/12 text-amber-100">
                      <AlertTriangle className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm uppercase tracking-[0.2em] text-amber-100/70">
                        Forecast warning
                      </p>
                      <h3 className="text-lg font-semibold text-white">
                        Agent {hostname} — {metricLabel(forecast.metric)} reaches 90% in{" "}
                        {forecast.exceedInHours?.toFixed(1)} hours
                      </h3>
                    </div>
                  </div>
                  <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-200">
                    {forecast.explanation ??
                      "Usage is trending toward the 90% threshold based on the current forecast window."}
                  </p>
                </button>

                <div className="flex items-center gap-2 self-start">
                  <Badge
                    variant="outline"
                    className="border-amber-400/20 bg-amber-300/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-amber-100"
                  >
                    {forecast.currentValue.toFixed(1)}% now
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={expanded ? "Collapse forecast" : "Expand forecast"}
                    onClick={() => setExpandedId(expanded ? null : forecast.id)}
                  >
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Dismiss forecast warning"
                    onClick={() => {
                      setDismissedIds((current) => [...current, forecast.id]);
                      if (expanded) {
                        setExpandedId(null);
                      }
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {expanded ? (
                <div className="mt-5 rounded-[26px] border border-white/8 bg-black/20 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">Trend projection</p>
                      <p className="text-xs text-slate-500">
                        Historical fit plus projected trajectory and confidence band.
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-blue-500/20 bg-blue-500/8 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-blue-100"
                    >
                      Predicted {forecast.predictedValue.toFixed(1)}%
                    </Badge>
                  </div>

                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ left: -20, right: 12, top: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`forecast-band-${forecast.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
                        <XAxis
                          dataKey="timestamp"
                          tickFormatter={(value: string) =>
                            new Intl.DateTimeFormat("en-US", {
                              hour: "2-digit",
                              minute: "2-digit"
                            }).format(new Date(value))
                          }
                          stroke="rgba(148,163,184,0.48)"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={40}
                        />
                        <YAxis
                          domain={[0, 100]}
                          stroke="rgba(148,163,184,0.48)"
                          tickLine={false}
                          axisLine={false}
                          width={34}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            if (name === "historical") {
                              return [`${value.toFixed(1)}%`, "Historical fit"];
                            }
                            if (name === "predicted") {
                              return [`${value.toFixed(1)}%`, "Predicted"];
                            }
                            if (name === "upper") {
                              return [`${value.toFixed(1)}%`, "Upper bound"];
                            }
                            return [`${value.toFixed(1)}%`, "Lower bound"];
                          }}
                          labelFormatter={(value: string) => formatCompactTimestamp(value)}
                          contentStyle={{
                            borderRadius: "18px",
                            border: "1px solid rgba(148, 163, 184, 0.18)",
                            backgroundColor: "rgba(15, 23, 42, 0.94)"
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="upper"
                          stroke="transparent"
                          fill={`url(#forecast-band-${forecast.id})`}
                          activeDot={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="lower"
                          stroke="transparent"
                          fill="rgba(10,10,15,0.96)"
                          activeDot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="historical"
                          stroke="#94a3b8"
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          stroke="#3b82f6"
                          strokeWidth={2.6}
                          dot={false}
                          connectNulls
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}

function buildForecastSeries(
  points: Array<{ ds: string; yhat: number; yhatLower: number; yhatUpper: number }>
) {
  const now = Date.now();

  return points.map((point) => {
    const isFuture = Date.parse(point.ds) > now;
    return {
      timestamp: point.ds,
      upper: point.yhatUpper,
      lower: point.yhatLower,
      historical: isFuture ? null : point.yhat,
      predicted: isFuture ? point.yhat : null
    };
  });
}

function metricLabel(metric: string): string {
  return metric.replace("_percent", "").replace(/_/g, " ");
}
