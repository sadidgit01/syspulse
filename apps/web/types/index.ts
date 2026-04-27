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

export interface AlertRule {
  id: string;
  name: string;
  metric: "cpuPercent" | "memoryPercent" | "diskPercent";
  threshold: number;
  severity: "warning" | "critical";
}

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

export interface AIQueryBackendResponse {
  answer: string;
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
