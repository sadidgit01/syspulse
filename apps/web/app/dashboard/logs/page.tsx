"use client";

import { useEffect, useState } from "react";

import { LogFiltersBar } from "@/components/logs/LogFilters";
import { LogStatsSidebar } from "@/components/logs/LogStatsSidebar";
import { LogStream } from "@/components/logs/LogStream";
import { Badge } from "@/components/ui/badge";
import { getLogStats, listAgents, listLogs } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import type { LogStats } from "@/types";

export default function LogsPage() {
  const agents = useSysPulseStore((state) => state.agents);
  const filters = useSysPulseStore((state) => state.logFilters);
  const setAgents = useSysPulseStore((state) => state.setAgents);
  const setLogs = useSysPulseStore((state) => state.setLogs);
  const setLogFilters = useSysPulseStore((state) => state.setLogFilters);
  const resetLogFilters = useSysPulseStore((state) => state.resetLogFilters);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [stats, setStats] = useState<LogStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAgents = async () => {
      try {
        const nextAgents = await listAgents();
        if (!cancelled) {
          setAgents(nextAgents);
        }
      } catch {
        if (!cancelled) {
          setAgents([]);
        }
      }
    };

    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, [setAgents]);

  useEffect(() => {
    let cancelled = false;

    const loadLogs = async () => {
      setLoadingLogs(true);
      try {
        const response = await listLogs(filters);
        if (!cancelled) {
          setLogs(response.logs);
          setLogsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLogsError(error instanceof Error ? error.message : "Unable to load logs.");
          setLogs([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingLogs(false);
        }
      }
    };

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, [filters, setLogs]);

  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      setLoadingStats(true);
      try {
        const nextStats = await getLogStats({
          agentId: filters.agentId,
          from: filters.from,
          to: filters.to
        });
        if (!cancelled) {
          setStats(nextStats);
          setStatsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setStatsError(error instanceof Error ? error.message : "Unable to load log stats.");
          setStats(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingStats(false);
        }
      }
    };

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [filters.agentId, filters.from, filters.to]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <Badge
            className="border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-blue-200"
            variant="outline"
          >
            Live Log Viewer
          </Badge>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Stream, filter, and correlate operational logs as they land.
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
              The viewer keeps the freshest events in memory, lets you drill down by agent and source,
              and pairs volume stats with a live stream tuned for real-time triage.
            </p>
          </div>
        </div>

        <Card className="panel-surface rounded-[28px] border border-slate-800/80 xl:w-[360px]">
          <CardContent className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Agent scope</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {filters.agentId
                  ? agents.find((agent) => agent.id === filters.agentId)?.hostname ?? "Selected"
                  : "All agents"}
              </p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Levels active</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {filters.levels.length > 0 ? filters.levels.length : "All"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <LogFiltersBar
        agents={agents}
        filters={filters}
        onChange={setLogFilters}
        onClear={() => {
          resetLogFilters();
          setLogsError(null);
          setStatsError(null);
        }}
      />

      <div className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
        <LogStream agents={agents} loading={loadingLogs} error={logsError} />
        <LogStatsSidebar stats={stats} loading={loadingStats} error={statsError} />
      </div>
    </div>
  );
}
