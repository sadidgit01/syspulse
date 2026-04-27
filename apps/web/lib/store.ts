import { create } from "zustand";

import type {
  Agent,
  AnomalyEvent,
  ForecastAlert,
  LogEntry,
  LogFilters,
  MetricSnapshot,
  WsStatus
} from "@/types";
import { createDefaultLogFilters, matchesLogFilters } from "@/lib/utils";

const MAX_SNAPSHOTS = 60;
const MAX_LOGS = 500;
const MAX_ANOMALIES = 50;
const MAX_TRACE_IDS = 10;

interface SysPulseStore {
  agents: Agent[];
  metrics: Record<string, MetricSnapshot[]>;
  logs: LogEntry[];
  anomalies: AnomalyEvent[];
  forecasts: ForecastAlert[];
  lastTraceIds: string[];
  logFilters: LogFilters;
  wsStatus: WsStatus;
  setAgents: (agents: Agent[]) => void;
  pushMetric: (snapshot: MetricSnapshot) => void;
  setLogs: (logs: LogEntry[]) => void;
  addLog: (entry: LogEntry) => void;
  setAnomalies: (events: AnomalyEvent[]) => void;
  addAnomaly: (event: AnomalyEvent) => void;
  setForecasts: (alerts: ForecastAlert[]) => void;
  addTraceId: (traceId: string) => void;
  setLogFilters: (nextFilters: Partial<LogFilters>) => void;
  resetLogFilters: () => void;
  setWsStatus: (status: WsStatus) => void;
}

function sortAgents(agents: Agent[]): Agent[] {
  return agents.slice().sort((left, right) => left.hostname.localeCompare(right.hostname));
}

function dedupeLogs(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  const results: LogEntry[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    results.push(entry);
  }

  return results;
}

function dedupeAnomalies(entries: AnomalyEvent[]): AnomalyEvent[] {
  const seen = new Set<string>();
  const results: AnomalyEvent[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    results.push(entry);
  }

  return results;
}

function sortAnomalies(entries: AnomalyEvent[]): AnomalyEvent[] {
  return entries
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function sortForecasts(entries: ForecastAlert[]): ForecastAlert[] {
  return entries.slice().sort((left, right) => {
    const leftScore = left.exceedInHours ?? Number.POSITIVE_INFINITY;
    const rightScore = right.exceedInHours ?? Number.POSITIVE_INFINITY;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export const useSysPulseStore = create<SysPulseStore>((set) => ({
  agents: [],
  metrics: {},
  logs: [],
  anomalies: [],
  forecasts: [],
  lastTraceIds: [],
  logFilters: createDefaultLogFilters(),
  wsStatus: "idle",
  setAgents: (agents) => {
    set((state) => {
      const metricAwareAgents = agents.map((agent) => {
        const latestSnapshot = state.metrics[agent.id]?.at(-1);
        if (!latestSnapshot) {
          return agent;
        }

        return {
          ...agent,
          lastSeen: latestSnapshot.timestamp,
          status: "alive" as const
        };
      });

      return { agents: sortAgents(metricAwareAgents) };
    });
  },
  pushMetric: (snapshot) => {
    set((state) => {
      const existingSeries = state.metrics[snapshot.agentId] ?? [];
      const nextSeries = [...existingSeries, snapshot].slice(-MAX_SNAPSHOTS);
      const nextAgents = state.agents.map((agent) =>
        agent.id === snapshot.agentId
          ? {
              ...agent,
              lastSeen: snapshot.timestamp,
              status: "alive" as const
            }
          : agent
      );

      return {
        metrics: {
          ...state.metrics,
          [snapshot.agentId]: nextSeries
        },
        agents: nextAgents
      };
    });
  },
  setLogs: (logs) => set({ logs: dedupeLogs(logs).slice(0, MAX_LOGS) }),
  addLog: (entry) => {
    set((state) => {
      if (!matchesLogFilters(entry, state.logFilters)) {
        return state;
      }

      const withoutDuplicate = state.logs.filter((existing) => existing.id !== entry.id);
      return {
        logs: [entry, ...withoutDuplicate].slice(0, MAX_LOGS)
      };
    });
  },
  setAnomalies: (events) =>
    set({
      anomalies: sortAnomalies(dedupeAnomalies(events)).slice(0, MAX_ANOMALIES)
    }),
  addAnomaly: (event) =>
    set((state) => {
      const nextEvents = sortAnomalies(
        dedupeAnomalies([event, ...state.anomalies]).slice(0, MAX_ANOMALIES)
      );
      return { anomalies: nextEvents };
    }),
  setForecasts: (alerts) =>
    set({
      forecasts: sortForecasts(alerts)
    }),
  addTraceId: (traceId) =>
    set((state) => ({
      lastTraceIds: [traceId, ...state.lastTraceIds.filter((existing) => existing !== traceId)].slice(
        0,
        MAX_TRACE_IDS
      )
    })),
  setLogFilters: (nextFilters) =>
    set((state) => ({
      logFilters: {
        ...state.logFilters,
        ...nextFilters
      }
    })),
  resetLogFilters: () =>
    set({
      logFilters: createDefaultLogFilters()
    }),
  setWsStatus: (status) => set({ wsStatus: status })
}));
