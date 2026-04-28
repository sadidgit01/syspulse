export type WsStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type UserRole = "admin" | "viewer" | "alert_manager";
export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type ForecastMetric = "cpu_percent" | "memory_percent" | "disk_percent";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "resolved";
export type IncidentEventType =
  | "metric_spike"
  | "log_error"
  | "anomaly"
  | "alert_fired"
  | "correlation"
  | "forecast_warning"
  | "comment"
  | "status_change";
export type AlertRuleConditionType = "threshold" | "relative" | "composite" | "anomaly_score";
export type AlertChannelType = "slack" | "discord" | "email" | "webhook";

export interface Agent {
  id: string;
  orgId: string;
  hostname: string;
  os: string;
  arch: string;
  lastSeen: string;
  status: "alive" | "offline";
}

export interface MetricSnapshot {
  agentId: string;
  timestamp: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  netBytesIn: number;
  netBytesOut: number;
}

export interface MetricSnapshotBackendPayload {
  timestamp?: string;
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  net_bytes_in?: number;
  net_bytes_out?: number;
}

export interface MetricStreamMessage {
  agent_id: string;
  timestamp: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  net_bytes_in?: number;
  net_bytes_out?: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  agentId: string;
  orgId: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogFilters {
  agentId: string;
  levels: LogLevel[];
  source: string;
  search: string;
  from: string;
  to: string;
}

export interface LogLevelCount {
  level: LogLevel;
  count: number;
}

export interface LogSourceCount {
  source: string;
  count: number;
}

export interface LogErrorRatePoint {
  timestamp: string;
  totalLogs: number;
  errorLogs: number;
  errorRate: number;
}

export interface LogStats {
  levels: LogLevelCount[];
  sources: LogSourceCount[];
  errorRateOverTime: LogErrorRatePoint[];
}

export interface MetricCorrelationData {
  agentId: string;
  orgId: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  netBytesIn: number;
  netBytesOut: number;
}

export interface LogCorrelationData {
  id: string;
  agentId: string;
  orgId: string;
  level: LogLevel;
  source: string;
  message: string;
}

export type CorrelationEvent =
  | {
      type: "metric";
      timestamp: string;
      data: MetricCorrelationData;
    }
  | {
      type: "log";
      timestamp: string;
      data: LogCorrelationData;
    };

export interface AnomalyEvent {
  id: string;
  orgId: string;
  agentId: string;
  score: number;
  reason: string;
  details: Record<string, unknown>;
  snapshot: MetricSnapshot | null;
  explanation: string | null;
  createdAt: string;
}

export interface ForecastPoint {
  ds: string;
  yhat: number;
  yhatLower: number;
  yhatUpper: number;
}

export interface ForecastAlert {
  id: string;
  orgId: string;
  agentId: string;
  metric: ForecastMetric;
  currentValue: number;
  predictedValue: number;
  exceedInHours: number | null;
  forecastPoints: ForecastPoint[];
  explanation: string | null;
  createdAt: string;
  isSent: boolean;
}

export interface IncidentEvent {
  eventId: string;
  timestamp: string;
  type: IncidentEventType;
  title: string;
  detail: string;
  metricSnapshot: {
    cpu: number;
    memory: number;
    disk: number;
  } | null;
  severity: IncidentSeverity;
}

export interface Incident {
  id: string;
  orgId: string;
  agentId: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  startedAt: string;
  resolvedAt: string | null;
  timelineEvents: IncidentEvent[];
  triggerType: string;
  triggerId: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertThresholdCondition {
  metric: ForecastMetric;
  operator: ">" | "<" | ">=" | "<=";
  value: number;
  duration_minutes: number;
}

export interface AlertRelativeCondition {
  metric: ForecastMetric;
  operator: ">" | "<";
  percent_change: number;
  baseline_hours: number;
}

export interface AlertCompositeSubCondition {
  metric: ForecastMetric;
  operator: ">" | "<" | ">=" | "<=";
  value: number;
}

export interface AlertCompositeCondition {
  operator: "AND" | "OR";
  conditions: AlertCompositeSubCondition[];
}

export interface AlertAnomalyScoreCondition {
  min_score: number;
  reasons: string[];
}

export type AlertCondition =
  | AlertThresholdCondition
  | AlertRelativeCondition
  | AlertCompositeCondition
  | AlertAnomalyScoreCondition;

export type AlertChannel =
  | {
      type: "slack" | "discord";
      webhook_url: string;
    }
  | {
      type: "email";
      address: string;
    }
  | {
      type: "webhook";
      url: string;
      method: "POST" | "PUT" | "PATCH";
    };

export interface AlertRule {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  conditionType: AlertRuleConditionType;
  condition: AlertCondition;
  severity: IncidentSeverity;
  channels: AlertChannel[];
  cooldownMinutes: number;
  lastFiredAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface OrganizationProfile {
  org_id: string;
  name: string;
  slug: string;
  org_token: string;
}

export interface MeBackendResponse {
  user: UserProfile;
  organization: OrganizationProfile;
  role: UserRole;
}

export interface AuthBackendResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RegisterBackendResponse extends AuthBackendResponse {
  user_id: string;
  org_id: string;
  org_token: string;
}

export interface LoginBackendResponse extends AuthBackendResponse {
  user: UserProfile;
}

export interface LogEntryBackendResponse {
  id: string;
  time: string;
  agent_id: string;
  org_id: string;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogsBackendResponse {
  logs: LogEntryBackendResponse[];
  total: number;
  page: number;
  pages: number;
}

export interface LogStatsBackendResponse {
  levels: Array<{ level: LogLevel; count: number }>;
  sources: Array<{ source: string; count: number }>;
  error_rate_over_time: Array<{
    timestamp: string;
    total_logs: number;
    error_logs: number;
    error_rate: number;
  }>;
}

export interface CorrelationBackendResponse {
  events: Array<{
    type: "metric" | "log";
    timestamp: string;
    data: Record<string, string | number>;
  }>;
}

export interface AnomalyEventBackendResponse {
  id: string;
  org_id: string;
  agent_id: string;
  score: number;
  reason: string;
  details: Record<string, unknown>;
  snapshot: MetricSnapshotBackendPayload | null;
  explanation: string | null;
  created_at: string;
}

export interface ForecastAlertBackendResponse {
  id: string;
  org_id: string;
  agent_id: string;
  metric: ForecastMetric;
  current_value: number;
  predicted_value: number;
  exceed_in_hours: number | null;
  forecast_points: Array<{
    ds: string;
    yhat: number;
    yhat_lower: number;
    yhat_upper: number;
  }>;
  explanation: string | null;
  created_at: string;
  is_sent: boolean;
}

export interface IncidentEventBackendResponse {
  event_id: string;
  timestamp: string;
  type: IncidentEventType;
  title: string;
  detail: string;
  metric_snapshot: {
    cpu: number;
    memory: number;
    disk: number;
  } | null;
  severity: IncidentSeverity;
}

export interface IncidentBackendResponse {
  id: string;
  org_id: string;
  agent_id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  started_at: string;
  resolved_at: string | null;
  timeline_events: IncidentEventBackendResponse[];
  trigger_type: string;
  trigger_id: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentListBackendResponse {
  incidents: IncidentBackendResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlertRuleBackendResponse {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  condition_type: AlertRuleConditionType;
  condition_json: AlertCondition;
  severity: IncidentSeverity;
  channels_json: AlertChannel[];
  cooldown_minutes: number;
  last_fired_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleTestBackendResponse {
  would_fire: boolean;
  matching_agents: string[];
  reason: string;
}

export interface AIQueryBackendResponse {
  answer: string;
}

export interface AIHealthScoreBackendResponse {
  score: number;
  label: string;
  agents: number;
  online: number;
  issues: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface SpanLogField {
  key: string;
  value: string | number | boolean | null;
}

export interface SpanLog {
  timestamp: string;
  fields: SpanLogField[];
}

export interface Span {
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTime: string;
  duration: number;
  tags: Record<string, string | number | boolean | null>;
  logs: SpanLog[];
}

export interface TraceListItem {
  traceId: string;
  serviceName: string;
  operationName: string;
  duration: number;
  startTime: string;
  spanCount: number;
  hasError: boolean;
}

export interface TraceDetail {
  traceId: string;
  spans: Span[];
}
