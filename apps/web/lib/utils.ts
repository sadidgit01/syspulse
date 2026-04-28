import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type {
  AlertChannel,
  AlertCondition,
  AlertRuleConditionType,
  Incident,
  IncidentEventType,
  IncidentSeverity,
  IncidentStatus,
  LogEntry,
  LogFilters,
  LogLevel,
  WsStatus
} from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(timestamp: string): string {
  const deltaInSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));

  if (deltaInSeconds < 5) {
    return "just now";
  }
  if (deltaInSeconds < 60) {
    return `${deltaInSeconds}s ago`;
  }
  if (deltaInSeconds < 3600) {
    return `${Math.floor(deltaInSeconds / 60)}m ago`;
  }
  if (deltaInSeconds < 86_400) {
    return `${Math.floor(deltaInSeconds / 3600)}h ago`;
  }
  return `${Math.floor(deltaInSeconds / 86_400)}d ago`;
}

export function formatClockTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

export function formatCompactTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

export function formatLongTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestamp));
}

export function formatDateTimeInputValue(timestamp: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatThroughput(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB/s`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB/s`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB/s`;
  }
  return `${bytes.toFixed(0)} B/s`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) {
    return `${Math.max(1, Math.round(totalMinutes))} minute${Math.round(totalMinutes) === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatIncidentDuration(incident: Incident): string | null {
  if (!incident.resolvedAt) {
    return null;
  }
  const durationInMinutes = Math.max(
    1,
    Math.round((Date.parse(incident.resolvedAt) - Date.parse(incident.startedAt)) / 60_000)
  );
  return `lasted ${formatDurationMinutes(durationInMinutes)}`;
}

export function getAgentToneClasses(lastSeen: string) {
  const ageInSeconds = (Date.now() - Date.parse(lastSeen)) / 1000;

  if (ageInSeconds < 45) {
    return {
      label: "alive",
      badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    };
  }
  if (ageInSeconds < 120) {
    return {
      label: "warm",
      badge: "border-yellow-500/30 bg-yellow-500/10 text-yellow-100"
    };
  }
  return {
    label: "cold",
    badge: "border-red-500/30 bg-red-500/10 text-red-200"
  };
}

export function getCpuHeatClasses(cpuPercent: number): string {
  if (cpuPercent > 85) {
    return "border-red-500/20 bg-red-500/14 shadow-[0_0_28px_rgba(239,68,68,0.12)]";
  }
  if (cpuPercent >= 60) {
    return "border-yellow-500/20 bg-yellow-500/14 shadow-[0_0_28px_rgba(250,204,21,0.1)]";
  }
  return "border-emerald-500/20 bg-emerald-500/14 shadow-[0_0_28px_rgba(34,197,94,0.1)]";
}

export function getStatusColor(status: WsStatus): string {
  if (status === "connected") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "connecting" || status === "reconnecting") {
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-100";
  }
  if (status === "error") {
    return "border-red-500/30 bg-red-500/10 text-red-200";
  }
  return "border-white/10 bg-white/[0.03] text-slate-300";
}

export function getIncidentSeverityClasses(severity: IncidentSeverity): string {
  if (severity === "critical") {
    return "border-red-500/30 bg-red-500/12 text-red-100";
  }
  if (severity === "high") {
    return "border-orange-500/30 bg-orange-500/12 text-orange-100";
  }
  if (severity === "medium") {
    return "border-amber-500/30 bg-amber-500/12 text-amber-100";
  }
  return "border-slate-500/20 bg-slate-500/10 text-slate-300";
}

export function getIncidentStatusClasses(status: IncidentStatus): string {
  if (status === "resolved") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "investigating") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  }
  return "border-red-500/30 bg-red-500/10 text-red-200";
}

export function getIncidentEventAccent(type: IncidentEventType): {
  dot: string;
  border: string;
  icon: string;
} {
  switch (type) {
    case "metric_spike":
      return { dot: "bg-red-400", border: "border-red-500/20 bg-red-500/8", icon: "metric" };
    case "log_error":
      return { dot: "bg-red-500", border: "border-red-500/20 bg-red-500/8", icon: "log" };
    case "anomaly":
      return { dot: "bg-fuchsia-400", border: "border-fuchsia-500/20 bg-fuchsia-500/8", icon: "anomaly" };
    case "alert_fired":
      return { dot: "bg-orange-400", border: "border-orange-500/20 bg-orange-500/8", icon: "alert" };
    case "correlation":
      return { dot: "bg-amber-400", border: "border-amber-500/20 bg-amber-500/8", icon: "correlation" };
    case "forecast_warning":
      return { dot: "bg-yellow-300", border: "border-yellow-500/20 bg-yellow-500/8", icon: "forecast" };
    case "status_change":
      return { dot: "bg-emerald-400", border: "border-emerald-500/20 bg-emerald-500/8", icon: "status" };
    default:
      return { dot: "bg-blue-400", border: "border-blue-500/20 bg-blue-500/8", icon: "comment" };
  }
}

export function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildAlertConditionSummary(
  conditionType: AlertRuleConditionType,
  condition: AlertCondition
): string {
  if (conditionType === "threshold") {
    const threshold = condition as Extract<AlertCondition, { duration_minutes: number }>;
    return `Alert when ${titleCase(threshold.metric.replace("_percent", ""))} ${threshold.operator} ${threshold.value}% for ${threshold.duration_minutes}+ minutes`;
  }
  if (conditionType === "relative") {
    const relative = condition as Extract<AlertCondition, { percent_change: number }>;
    const direction = relative.operator === ">" ? "rises" : "drops";
    return `Alert when ${titleCase(relative.metric.replace("_percent", ""))} ${direction} by ${relative.percent_change}% versus the last ${relative.baseline_hours} hours`;
  }
  if (conditionType === "composite") {
    const composite = condition as Extract<AlertCondition, { conditions: Array<{ metric: string }> }>;
    return composite.conditions
      .map((item) => `${titleCase(item.metric.replace("_percent", ""))} ${item.operator} ${item.value}%`)
      .join(` ${composite.operator} `);
  }

  const anomaly = condition as Extract<AlertCondition, { min_score: number }>;
  const reasons = anomaly.reasons.length > 0 ? anomaly.reasons.map(titleCase).join(", ") : "any reason";
  return `Alert when anomaly score >= ${anomaly.min_score.toFixed(1)} for ${reasons}`;
}

export function getChannelLabel(channel: AlertChannel): string {
  if (channel.type === "email") {
    return channel.address;
  }
  if (channel.type === "webhook") {
    return `${channel.method} ${channel.url}`;
  }
  return channel.webhook_url;
}

export function titleCaseWsStatus(status: WsStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function getLogLevelBadgeClasses(level: LogLevel): string {
  if (level === "DEBUG") {
    return "border-slate-500/20 bg-slate-500/10 text-slate-300";
  }
  if (level === "INFO") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-100";
  }
  if (level === "WARNING") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-100";
  }
  if (level === "CRITICAL") {
    return "animate-pulse border-red-500/30 bg-red-500/16 text-red-100";
  }
  return "border-red-500/20 bg-red-500/10 text-red-100";
}

export function createDefaultLogFilters(): LogFilters {
  return {
    agentId: "",
    levels: [],
    source: "",
    search: "",
    from: "",
    to: ""
  };
}

export function matchesLogFilters(entry: LogEntry, filters: LogFilters): boolean {
  if (filters.agentId && entry.agentId !== filters.agentId) {
    return false;
  }
  if (filters.levels.length > 0 && !filters.levels.includes(entry.level)) {
    return false;
  }
  if (filters.source && !entry.source.toLowerCase().includes(filters.source.toLowerCase())) {
    return false;
  }
  if (filters.search && !entry.message.toLowerCase().includes(filters.search.toLowerCase())) {
    return false;
  }
  if (filters.from && Date.parse(entry.timestamp) < Date.parse(filters.from)) {
    return false;
  }
  if (filters.to && Date.parse(entry.timestamp) > Date.parse(filters.to)) {
    return false;
  }
  return true;
}
