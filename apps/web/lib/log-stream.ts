import type { LogEntry } from "@/types";

interface LogStreamOptions {
  onLog: (entry: LogEntry) => void;
}

export class LogStreamClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private readonly onLog: (entry: LogEntry) => void;

  constructor({ onLog }: LogStreamOptions) {
    this.onLog = onLog;
  }

  connect() {
    if (typeof window === "undefined") {
      return;
    }

    this.manuallyClosed = false;
    this.clearReconnectTimer();

    this.eventSource = new EventSource("/api/logs/stream");
    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };
    this.eventSource.onmessage = (event) => {
      const parsed = parseLogEntry(event.data);
      if (parsed) {
        this.onLog(parsed);
      }
    };
    this.eventSource.onerror = () => {
      if (this.manuallyClosed) {
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.eventSource?.close();
    this.eventSource = null;
  }

  private scheduleReconnect() {
    this.eventSource?.close();
    this.eventSource = null;
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempts - 1));
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

function parseLogEntry(rawData: string): LogEntry | null {
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.timestamp !== "string" ||
      typeof parsed.agent_id !== "string" ||
      typeof parsed.org_id !== "string" ||
      typeof parsed.level !== "string" ||
      typeof parsed.source !== "string" ||
      typeof parsed.message !== "string"
    ) {
      return null;
    }

    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      agentId: parsed.agent_id,
      orgId: parsed.org_id,
      level: parsed.level as LogEntry["level"],
      source: parsed.source,
      message: parsed.message
    };
  } catch {
    return null;
  }
}
