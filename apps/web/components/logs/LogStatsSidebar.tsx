"use client";

import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatClockTime } from "@/lib/utils";
import type { LogStats } from "@/types";

const LEVEL_COLORS = {
  DEBUG: "#64748b",
  INFO: "#3b82f6",
  WARNING: "#f59e0b",
  ERROR: "#ef4444",
  CRITICAL: "#dc2626"
} as const;

export function LogStatsSidebar({
  stats,
  loading,
  error
}: {
  stats: LogStats | null;
  loading: boolean;
  error: string | null;
}) {
  const levelData =
    stats?.levels.filter((entry) => entry.count > 0).map((entry) => ({
      ...entry,
      color: LEVEL_COLORS[entry.level]
    })) ?? [];
  const sourceData = stats?.sources.slice(0, 5) ?? [];
  const errorRateData =
    stats?.errorRateOverTime.map((point) => ({
      ...point,
      label: formatClockTime(point.timestamp)
    })) ?? [];

  return (
    <div className="space-y-4">
      <Card className="panel-surface rounded-3xl border border-slate-800/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-white">Level distribution</CardTitle>
          <CardDescription className="text-slate-400">
            Donut view of the current query window.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72 pt-4">
          {loading ? (
            <SidebarState message="Calculating log mix..." />
          ) : error ? (
            <SidebarState message={error} danger />
          ) : levelData.length === 0 ? (
            <SidebarState message="No logs in the selected window." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={levelData}
                  dataKey="count"
                  nameKey="level"
                  innerRadius={62}
                  outerRadius={96}
                  stroke="rgba(10,10,15,0.8)"
                  strokeWidth={6}
                >
                  {levelData.map((entry) => (
                    <Cell key={entry.level} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: "18px",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    backgroundColor: "rgba(15, 23, 42, 0.92)"
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="panel-surface rounded-3xl border border-slate-800/80">
        <CardHeader className="pb-2">
          <CardTitle className="text-white">Error rate, last 24h</CardTitle>
          <CardDescription className="text-slate-400">
            Hourly error share from the selected agent/time scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="h-72 pt-4">
          {loading ? (
            <SidebarState message="Loading hourly error trend..." />
          ) : error ? (
            <SidebarState message={error} danger />
          ) : errorRateData.length === 0 ? (
            <SidebarState message="No hourly error data available." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={errorRateData} margin={{ left: -14, right: 8, top: 10, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "rgba(148,163,184,0.82)", fontSize: 11 }}
                  minTickGap={18}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "rgba(148,163,184,0.82)", fontSize: 11 }}
                  width={38}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Error rate"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
                  contentStyle={{
                    borderRadius: "18px",
                    border: "1px solid rgba(148, 163, 184, 0.18)",
                    backgroundColor: "rgba(15, 23, 42, 0.92)"
                  }}
                />
                <Bar dataKey="errorRate" fill="#ef4444" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="panel-surface rounded-3xl border border-slate-800/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-white">Top sources</CardTitle>
          <CardDescription className="text-slate-400">
            Highest-volume sources in the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <SidebarState message="Ranking sources..." />
          ) : error ? (
            <SidebarState message={error} danger />
          ) : sourceData.length === 0 ? (
            <SidebarState message="No sources available yet." />
          ) : (
            sourceData.map((entry, index) => (
              <div
                key={`${entry.source}-${index}`}
                className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{entry.source}</p>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Source</p>
                </div>
                <p className="text-sm font-semibold text-blue-100">{entry.count}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SidebarState({ message, danger = false }: { message: string; danger?: boolean }) {
  return (
    <div
      className={
        danger
          ? "flex h-full items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/8 px-4 text-center text-sm text-red-200"
          : "flex h-full items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-center text-sm text-slate-400"
      }
    >
      {message}
    </div>
  );
}
