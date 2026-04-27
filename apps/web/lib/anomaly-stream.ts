import type { AnomalyEvent, MetricSnapshot } from "@/types";

interface AnomalyStreamOptions {
  onAnomaly: (entry: AnomalyEvent) => void;
}

export class AnomalyStreamClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private readonly onAnomaly: (entry: AnomalyEvent) => void;

  constructor({ onAnomaly }: AnomalyStreamOptions) {
    this.onAnomaly = onAnomaly;
  }

  connect() {
    if (typeof window === "undefined") {
      return;
    }

    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.eventSource = new EventSource("/api/anomalies/stream");

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (event) => {
      const parsed = parseAnomalyEvent(event.data);
      if (parsed) {
        this.onAnomaly(parsed);
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

function parseAnomalyEvent(rawData: string): AnomalyEvent | null {
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    const eventId = typeof parsed.event_id === "string" ? parsed.event_id : parsed.id;
    const agentId = parsed.agent_id;
    const orgId = parsed.org_id;
    const timestamp = parsed.timestamp;
    const anomaly = parsed.anomaly;
    const explanation = parsed.explanation;

    if (
      typeof eventId !== "string" ||
      typeof agentId !== "string" ||
      typeof orgId !== "string" ||
      typeof timestamp !== "string" ||
      !isObject(anomaly)
    ) {
      return null;
    }

    return {
      id: eventId,
      agentId,
      orgId,
      createdAt: timestamp,
      score: typeof anomaly.score === "number" ? anomaly.score : 0,
      reason: typeof anomaly.reason === "string" ? anomaly.reason : "none",
      details: isObject(anomaly.details) ? anomaly.details : {},
      snapshot: parseMetricSnapshot(agentId, parsed.snapshot, timestamp),
      explanation: typeof explanation === "string" ? explanation : null
    };
  } catch {
    return null;
  }
}

function parseMetricSnapshot(
  agentId: string,
  rawSnapshot: unknown,
  fallbackTimestamp: string
): MetricSnapshot | null {
  if (!isObject(rawSnapshot)) {
    return null;
  }

  return {
    agentId,
    timestamp:
      typeof rawSnapshot.timestamp === "string" ? rawSnapshot.timestamp : fallbackTimestamp,
    cpuPercent: readNumeric(rawSnapshot.cpu_percent),
    memoryPercent: readNumeric(rawSnapshot.memory_percent),
    diskPercent: readNumeric(rawSnapshot.disk_percent),
    netBytesIn: readNumeric(rawSnapshot.net_bytes_in),
    netBytesOut: readNumeric(rawSnapshot.net_bytes_out)
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNumeric(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
