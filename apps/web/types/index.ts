export type WsStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
export type UserRole = "admin" | "viewer" | "alert_manager";

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
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
}

export interface AlertRule {
  id: string;
  name: string;
  metric: "cpuPercent" | "memoryPercent" | "diskPercent";
  threshold: number;
  severity: "warning" | "critical";
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
