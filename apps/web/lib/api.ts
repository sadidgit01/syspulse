import { logout, refreshAccessToken } from "@/lib/auth";
import type {
  Agent,
  AIQueryBackendResponse,
  AnomalyEvent,
  AnomalyEventBackendResponse,
  CorrelationBackendResponse,
  CorrelationEvent,
  ForecastAlert,
  ForecastAlertBackendResponse,
  ForecastMetric,
  LogEntry,
  LogEntryBackendResponse,
  LogFilters,
  LogStats,
  LogStatsBackendResponse,
  MetricSnapshot,
  MetricSnapshotBackendPayload,
  LogsBackendResponse
} from "@/types";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

interface AgentApiResponse {
  id: string;
  org_id: string;
  hostname: string;
  os: string;
  arch: string;
  last_seen: string;
  status: "alive" | "offline";
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getWebSocketBaseUrl(): string {
  return DEFAULT_WS_URL.replace(/\/$/, "");
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retried = false
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api/proxy${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include"
  });

  if (response.status === 401 && !retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, init, true);
    }

    await logout();
    throw new ApiError("Session expired.", 401);
  }

  if (!response.ok) {
    let detail = "Unexpected API error.";

    try {
      const body = (await response.json()) as { detail?: string };
      if (typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      detail = response.statusText || detail;
    }

    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}

export async function listAgents(): Promise<Agent[]> {
  const data = await apiFetch<AgentApiResponse[]>("/agents");
  return data.map((agent) => ({
    id: agent.id,
    orgId: agent.org_id,
    hostname: agent.hostname,
    os: agent.os,
    arch: agent.arch,
    lastSeen: agent.last_seen,
    status: agent.status
  }));
}

export async function listLogs(filters: LogFilters): Promise<{
  logs: LogEntry[];
  total: number;
  page: number;
  pages: number;
}> {
  const query = new URLSearchParams();
  if (filters.agentId) {
    query.set("agent_id", filters.agentId);
  }
  for (const level of filters.levels) {
    query.append("level", level);
  }
  if (filters.source) {
    query.set("source", filters.source);
  }
  if (filters.search) {
    query.set("search", filters.search);
  }
  if (filters.from) {
    query.set("from", new Date(filters.from).toISOString());
  }
  if (filters.to) {
    query.set("to", new Date(filters.to).toISOString());
  }
  query.set("page", "1");
  query.set("page_size", "200");

  const data = await apiFetch<LogsBackendResponse>(`/logs?${query.toString()}`);
  return {
    logs: data.logs.map(mapLogEntry),
    total: data.total,
    page: data.page,
    pages: data.pages
  };
}

export async function getLogStats(filters: Pick<LogFilters, "agentId" | "from" | "to">): Promise<LogStats> {
  const query = new URLSearchParams();
  if (filters.agentId) {
    query.set("agent_id", filters.agentId);
  }
  const now = new Date();
  const from = filters.from
    ? new Date(filters.from)
    : new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = filters.to ? new Date(filters.to) : now;
  query.set("from", from.toISOString());
  query.set("to", to.toISOString());

  const data = await apiFetch<LogStatsBackendResponse>(`/logs/stats?${query.toString()}`);
  return {
    levels: data.levels,
    sources: data.sources,
    errorRateOverTime: data.error_rate_over_time.map((point) => ({
      timestamp: point.timestamp,
      totalLogs: point.total_logs,
      errorLogs: point.error_logs,
      errorRate: point.error_rate
    }))
  };
}

export async function getCorrelation(agentId: string, from: string, to: string): Promise<CorrelationEvent[]> {
  const query = new URLSearchParams({
    agent_id: agentId,
    from,
    to
  });
  const data = await apiFetch<CorrelationBackendResponse>(`/correlate?${query.toString()}`);
  return data.events.map((event) => {
    if (event.type === "metric") {
      return {
        type: "metric",
        timestamp: event.timestamp,
        data: {
          agentId: String(event.data.agent_id),
          orgId: String(event.data.org_id),
          cpuPercent: Number(event.data.cpu_percent ?? 0),
          memoryPercent: Number(event.data.memory_percent ?? 0),
          diskPercent: Number(event.data.disk_percent ?? 0),
          netBytesIn: Number(event.data.net_bytes_in ?? 0),
          netBytesOut: Number(event.data.net_bytes_out ?? 0)
        }
      };
    }

    return {
      type: "log",
      timestamp: event.timestamp,
      data: {
        id: String(event.data.id),
        agentId: String(event.data.agent_id),
        orgId: String(event.data.org_id),
        level: String(event.data.level) as LogEntry["level"],
        source: String(event.data.source),
        message: String(event.data.message)
      }
    };
  });
}

export async function listAnomalies(filters?: {
  agentId?: string;
  from?: string;
  to?: string;
  minScore?: number;
}): Promise<AnomalyEvent[]> {
  const query = new URLSearchParams();
  if (filters?.agentId) {
    query.set("agent_id", filters.agentId);
  }
  if (filters?.from) {
    query.set("from", filters.from);
  }
  if (filters?.to) {
    query.set("to", filters.to);
  }
  query.set("min_score", String(filters?.minScore ?? 0.5));

  const suffix = query.toString();
  const data = await apiFetch<AnomalyEventBackendResponse[]>(
    suffix ? `/anomalies?${suffix}` : "/anomalies"
  );
  return data.map(mapAnomalyEvent);
}

export async function listForecasts(filters?: {
  agentId?: string;
  metric?: ForecastMetric;
}): Promise<ForecastAlert[]> {
  const query = new URLSearchParams();
  if (filters?.agentId) {
    query.set("agent_id", filters.agentId);
  }
  if (filters?.metric) {
    query.set("metric", filters.metric);
  }

  const suffix = query.toString();
  const data = await apiFetch<ForecastAlertBackendResponse[]>(
    suffix ? `/forecasts?${suffix}` : "/forecasts"
  );
  return data.map(mapForecastAlert);
}

export async function askAI(question: string): Promise<string> {
  const data = await apiFetch<AIQueryBackendResponse>("/ai/query", {
    method: "POST",
    body: JSON.stringify({ question })
  });
  return data.answer;
}

function mapLogEntry(entry: LogEntryBackendResponse): LogEntry {
  return {
    id: entry.id,
    timestamp: entry.time,
    agentId: entry.agent_id,
    orgId: entry.org_id,
    level: entry.level,
    source: entry.source,
    message: entry.message
  };
}

function mapMetricSnapshot(
  agentId: string,
  payload: MetricSnapshotBackendPayload | null,
  fallbackTimestamp: string
): MetricSnapshot | null {
  if (!payload) {
    return null;
  }

  return {
    agentId,
    timestamp: payload.timestamp ?? fallbackTimestamp,
    cpuPercent: Number(payload.cpu_percent ?? 0),
    memoryPercent: Number(payload.memory_percent ?? 0),
    diskPercent: Number(payload.disk_percent ?? 0),
    netBytesIn: Number(payload.net_bytes_in ?? 0),
    netBytesOut: Number(payload.net_bytes_out ?? 0)
  };
}

function mapAnomalyEvent(entry: AnomalyEventBackendResponse): AnomalyEvent {
  return {
    id: entry.id,
    orgId: entry.org_id,
    agentId: entry.agent_id,
    score: Number(entry.score),
    reason: entry.reason,
    details: entry.details ?? {},
    snapshot: mapMetricSnapshot(entry.agent_id, entry.snapshot, entry.created_at),
    explanation: entry.explanation,
    createdAt: entry.created_at
  };
}

function mapForecastAlert(entry: ForecastAlertBackendResponse): ForecastAlert {
  return {
    id: entry.id,
    orgId: entry.org_id,
    agentId: entry.agent_id,
    metric: entry.metric,
    currentValue: Number(entry.current_value),
    predictedValue: Number(entry.predicted_value),
    exceedInHours: entry.exceed_in_hours === null ? null : Number(entry.exceed_in_hours),
    forecastPoints: entry.forecast_points.map((point) => ({
      ds: point.ds,
      yhat: Number(point.yhat),
      yhatLower: Number(point.yhat_lower),
      yhatUpper: Number(point.yhat_upper)
    })),
    explanation: entry.explanation,
    createdAt: entry.created_at,
    isSent: entry.is_sent
  };
}
