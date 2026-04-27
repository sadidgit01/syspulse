import { getWebSocketBaseUrl } from "@/lib/api";
import type { MetricSnapshot, MetricStreamMessage, WsStatus } from "@/types";

interface MetricsWebSocketOptions {
  orgId: string;
  onMetric: (snapshot: MetricSnapshot) => void;
  onStatusChange: (status: WsStatus) => void;
}

function isMetricStreamMessage(payload: unknown): payload is MetricStreamMessage {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }

  const record = payload as Record<string, unknown>;

  return (
    typeof record.agent_id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.cpu_percent === "number" &&
    typeof record.memory_percent === "number" &&
    typeof record.disk_percent === "number"
  );
}

export class MetricsWebSocketClient {
  private websocket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private readonly orgId: string;
  private readonly onMetric: (snapshot: MetricSnapshot) => void;
  private readonly onStatusChange: (status: WsStatus) => void;

  constructor({ orgId, onMetric, onStatusChange }: MetricsWebSocketOptions) {
    this.orgId = orgId;
    this.onMetric = onMetric;
    this.onStatusChange = onStatusChange;
  }

  connect() {
    if (typeof window === "undefined") {
      return;
    }

    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.onStatusChange(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    this.websocket = new WebSocket(this.buildWebSocketUrl());
    this.websocket.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStatusChange("connected");
    };

    this.websocket.onmessage = (event) => {
      const parsed = this.parseMessage(event.data);
      if (parsed) {
        this.onMetric(parsed);
      }
    };

    this.websocket.onerror = () => {
      this.onStatusChange("error");
    };

    this.websocket.onclose = () => {
      if (this.manuallyClosed) {
        this.onStatusChange("disconnected");
        return;
      }

      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    this.onStatusChange("disconnected");
  }

  private buildWebSocketUrl(): string {
    return `${getWebSocketBaseUrl()}/ws/${this.orgId}`;
  }

  private scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempts - 1));
    this.onStatusChange("reconnecting");
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private parseMessage(rawData: string): MetricSnapshot | null {
    try {
      const parsed = JSON.parse(rawData) as unknown;
      if (!isMetricStreamMessage(parsed)) {
        return null;
      }

      return {
        agentId: parsed.agent_id,
        timestamp: parsed.timestamp,
        cpuPercent: parsed.cpu_percent,
        memoryPercent: parsed.memory_percent,
        diskPercent: parsed.disk_percent,
        netBytesIn: parsed.net_bytes_in ?? 0,
        netBytesOut: parsed.net_bytes_out ?? 0
      };
    } catch {
      return null;
    }
  }
}
