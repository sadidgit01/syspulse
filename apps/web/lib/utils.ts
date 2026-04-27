import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { LogEntry, LogFilters, LogLevel, WsStatus } from "@/types";

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

export function getAgentToneClasses(lastSeen: string) {
  const ageInSeconds = (Date.now() - Date.parse(lastSeen)) / 1000;

  if (ageInSeconds < 30) {
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
