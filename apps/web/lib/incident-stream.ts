import type { Incident, IncidentBackendResponse } from "@/types";

interface IncidentStreamOptions {
  onIncident: (incident: Incident) => void;
}

export class IncidentStreamClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private readonly onIncident: (incident: Incident) => void;

  constructor({ onIncident }: IncidentStreamOptions) {
    this.onIncident = onIncident;
  }

  connect() {
    if (typeof window === "undefined") {
      return;
    }

    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.eventSource = new EventSource("/api/incidents/stream");
    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
    };
    this.eventSource.onmessage = (event) => {
      const parsed = parseIncident(event.data);
      if (parsed) {
        this.onIncident(parsed);
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

function parseIncident(rawData: string): Incident | null {
  try {
    const parsed = JSON.parse(rawData) as IncidentBackendResponse;
    if (typeof parsed.id !== "string" || !Array.isArray(parsed.timeline_events)) {
      return null;
    }

    return {
      id: parsed.id,
      orgId: parsed.org_id,
      agentId: parsed.agent_id,
      title: parsed.title,
      status: parsed.status,
      severity: parsed.severity,
      startedAt: parsed.started_at,
      resolvedAt: parsed.resolved_at,
      timelineEvents: parsed.timeline_events.map((event) => ({
        eventId: event.event_id,
        timestamp: event.timestamp,
        type: event.type,
        title: event.title,
        detail: event.detail,
        metricSnapshot: event.metric_snapshot,
        severity: event.severity
      })),
      triggerType: parsed.trigger_type,
      triggerId: parsed.trigger_id,
      summary: parsed.summary,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at
    };
  } catch {
    return null;
  }
}
