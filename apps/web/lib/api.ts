import { logout, refreshAccessToken } from "@/lib/auth";
import { useSysPulseStore } from "@/lib/store";
import type {
  Agent,
  AIHealthScoreBackendResponse,
  AIQueryBackendResponse,
  AlertChannel,
  AlertCondition,
  AlertRule,
  AlertRuleBackendResponse,
  AlertRuleConditionType,
  AlertRuleTestBackendResponse,
  AnomalyEvent,
  AnomalyEventBackendResponse,
  CorrelationBackendResponse,
  CorrelationEvent,
  ForecastAlert,
  ForecastAlertBackendResponse,
  ForecastMetric,
  Incident,
  IncidentBackendResponse,
  IncidentListBackendResponse,
  IncidentSeverity,
  IncidentStatus,
  LogEntry,
  LogEntryBackendResponse,
  LogFilters,
  LogStats,
  LogStatsBackendResponse,
  LogsBackendResponse,
  MetricSnapshot,
  MetricSnapshotBackendPayload,
  TraceDetail,
  TraceListItem
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
  rememberTraceId(response.headers.get("X-Trace-ID"));

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

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listTraces(filters?: {
  service?: string;
  limit?: number;
  search?: string;
  from?: string;
  to?: string;
}): Promise<TraceListItem[]> {
  const query = new URLSearchParams();
  query.set("service", filters?.service ?? "syspulse-api");
  query.set("limit", String(filters?.limit ?? 20));
  if (filters?.search) {
    query.set("search", filters.search);
  }
  if (filters?.from) {
    query.set("from", filters.from);
  }
  if (filters?.to) {
    query.set("to", filters.to);
  }

  const response = await fetch(`/api/traces?${query.toString()}`, {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) {
    throw new ApiError("Unable to load traces.", response.status);
  }
  return (await response.json()) as TraceListItem[];
}

export async function getTraceDetail(traceId: string): Promise<TraceDetail> {
  const response = await fetch(`/api/traces/${encodeURIComponent(traceId)}`, {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) {
    throw new ApiError("Unable to load trace detail.", response.status);
  }
  return (await response.json()) as TraceDetail;
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

export async function listIncidents(filters?: {
  status?: IncidentStatus;
  agentId?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  incidents: Incident[];
  total: number;
  limit: number;
  offset: number;
}> {
  const query = new URLSearchParams();
  if (filters?.status) {
    query.set("status", filters.status);
  }
  if (filters?.agentId) {
    query.set("agent_id", filters.agentId);
  }
  query.set("limit", String(filters?.limit ?? 50));
  query.set("offset", String(filters?.offset ?? 0));
  const suffix = query.toString();
  const data = await apiFetch<IncidentListBackendResponse>(`/incidents?${suffix}`);
  return {
    incidents: data.incidents.map(mapIncident),
    total: data.total,
    limit: data.limit,
    offset: data.offset
  };
}

export async function getIncident(incidentId: string): Promise<Incident> {
  const data = await apiFetch<IncidentBackendResponse>(`/incidents/${incidentId}`);
  return mapIncident(data);
}

export async function createIncident(input: {
  agentId: string;
  title: string;
  severity: IncidentSeverity;
  comment: string;
}): Promise<Incident> {
  const data = await apiFetch<IncidentBackendResponse>("/incidents", {
    method: "POST",
    body: JSON.stringify({
      agent_id: input.agentId,
      title: input.title,
      severity: input.severity,
      comment: input.comment
    })
  });
  return mapIncident(data);
}

export async function commentOnIncident(incidentId: string, comment: string): Promise<Incident> {
  const data = await apiFetch<IncidentBackendResponse>(`/incidents/${incidentId}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment })
  });
  return mapIncident(data);
}

export async function resolveIncident(incidentId: string, comment: string): Promise<Incident> {
  const data = await apiFetch<IncidentBackendResponse>(`/incidents/${incidentId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ comment })
  });
  return mapIncident(data);
}

export async function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatus,
  comment?: string
): Promise<Incident> {
  const data = await apiFetch<IncidentBackendResponse>(`/incidents/${incidentId}/status`, {
    method: "POST",
    body: JSON.stringify({ status, comment })
  });
  return mapIncident(data);
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const data = await apiFetch<AlertRuleBackendResponse[]>("/alert-rules");
  return data.map(mapAlertRule);
}

export async function createAlertRule(input: {
  name: string;
  description: string | null;
  isEnabled: boolean;
  conditionType: AlertRuleConditionType;
  conditionJson: AlertCondition;
  severity: IncidentSeverity;
  channelsJson: AlertChannel[];
  cooldownMinutes: number;
}): Promise<AlertRule> {
  const data = await apiFetch<AlertRuleBackendResponse>("/alert-rules", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      is_enabled: input.isEnabled,
      condition_type: input.conditionType,
      condition_json: input.conditionJson,
      severity: input.severity,
      channels_json: input.channelsJson,
      cooldown_minutes: input.cooldownMinutes
    })
  });
  return mapAlertRule(data);
}

export async function updateAlertRule(
  ruleId: string,
  patch: Partial<{
    name: string;
    description: string | null;
    isEnabled: boolean;
    conditionType: AlertRuleConditionType;
    conditionJson: AlertCondition;
    severity: IncidentSeverity;
    channelsJson: AlertChannel[];
    cooldownMinutes: number;
  }>
): Promise<AlertRule> {
  const data = await apiFetch<AlertRuleBackendResponse>(`/alert-rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isEnabled !== undefined ? { is_enabled: patch.isEnabled } : {}),
      ...(patch.conditionType !== undefined ? { condition_type: patch.conditionType } : {}),
      ...(patch.conditionJson !== undefined ? { condition_json: patch.conditionJson } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.channelsJson !== undefined ? { channels_json: patch.channelsJson } : {}),
      ...(patch.cooldownMinutes !== undefined ? { cooldown_minutes: patch.cooldownMinutes } : {})
    })
  });
  return mapAlertRule(data);
}

export async function deleteAlertRule(ruleId: string): Promise<void> {
  await apiFetch<void>(`/alert-rules/${ruleId}`, {
    method: "DELETE"
  });
}

export async function testAlertRule(ruleId: string): Promise<AlertRuleTestBackendResponse> {
  return apiFetch<AlertRuleTestBackendResponse>(`/alert-rules/${ruleId}/test`, {
    method: "POST"
  });
}

export async function testAlertChannel(channel: AlertChannel): Promise<{ ok: boolean; detail: string }> {
  const response = await fetch("/api/alert-rules/test-channel", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(channel)
  });

  const data = (await response.json()) as { detail?: string };
  if (!response.ok) {
    throw new ApiError(data.detail ?? "Unable to test notification channel.", response.status);
  }

  return {
    ok: true,
    detail: data.detail ?? "Test message sent."
  };
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

export async function getAIHealthScore(): Promise<AIHealthScoreBackendResponse> {
  return apiFetch<AIHealthScoreBackendResponse>("/ai/health-score");
}

function rememberTraceId(traceId: string | null): void {
  if (!traceId) {
    return;
  }
  useSysPulseStore.getState().addTraceId(traceId);
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

function mapIncident(entry: IncidentBackendResponse): Incident {
  return {
    id: entry.id,
    orgId: entry.org_id,
    agentId: entry.agent_id,
    title: entry.title,
    status: entry.status,
    severity: entry.severity,
    startedAt: entry.started_at,
    resolvedAt: entry.resolved_at,
    timelineEvents: entry.timeline_events.map((event) => ({
      eventId: event.event_id,
      timestamp: event.timestamp,
      type: event.type,
      title: event.title,
      detail: event.detail,
      metricSnapshot: event.metric_snapshot,
      severity: event.severity
    })),
    triggerType: entry.trigger_type,
    triggerId: entry.trigger_id,
    summary: entry.summary,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at
  };
}

function mapAlertRule(entry: AlertRuleBackendResponse): AlertRule {
  return {
    id: entry.id,
    orgId: entry.org_id,
    name: entry.name,
    description: entry.description,
    isEnabled: entry.is_enabled,
    conditionType: entry.condition_type,
    condition: entry.condition_json,
    severity: entry.severity,
    channels: entry.channels_json,
    cooldownMinutes: entry.cooldown_minutes,
    lastFiredAt: entry.last_fired_at,
    createdBy: entry.created_by,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at
  };
}
