export type WsStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

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
