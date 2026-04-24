"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClockTime, formatCompactTimestamp } from "@/lib/utils";
import type { MetricSnapshot } from "@/types";

type MetricField = "cpuPercent" | "memoryPercent" | "diskPercent";

export function MetricChart({
  title,
  description,
  metricKey,
  data,
  color
}: {
  title: string;
  description: string;
  metricKey: MetricField;
  data: MetricSnapshot[];
  color: string;
}) {
  const chartData = data.map((snapshot) => ({
    label: formatClockTime(snapshot.timestamp),
    tooltipLabel: formatCompactTimestamp(snapshot.timestamp),
    value: snapshot[metricKey]
  }));
  const latestValue = chartData.at(-1)?.value ?? null;

  return (
    <Card className="panel-surface panel-hover rounded-3xl border border-slate-800/80">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-white">{title}</CardTitle>
            <CardDescription className="mt-1 text-slate-400">{description}</CardDescription>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-right">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Live</p>
            <p className="text-xl font-semibold text-white">
              {latestValue !== null ? `${latestValue.toFixed(1)}%` : "--"}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ left: -18, right: 8, top: 12, bottom: 0 }}>
              <defs>
                <linearGradient id={`${metricKey}-gradient`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }}
                minTickGap={18}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "rgba(148,163,184,0.8)", fontSize: 11 }}
                domain={[0, 100]}
                width={34}
              />
              <Tooltip
                cursor={{ stroke: color, strokeOpacity: 0.26 }}
                contentStyle={{
                  borderRadius: "18px",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  backgroundColor: "rgba(15, 23, 42, 0.92)",
                  boxShadow: "0 18px 40px rgba(2,6,23,0.32)"
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, title]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipLabel ?? ""}
              />
              <Area
                dataKey="value"
                type="monotone"
                stroke={color}
                strokeWidth={2.4}
                fill={`url(#${metricKey}-gradient)`}
                dot={false}
                activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
                isAnimationActive={true}
                animationDuration={320}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
