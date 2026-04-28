"use client";

import {
  Bot,
  BellRing,
  CheckCircle2,
  CircleAlert,
  Link2,
  MessageSquare,
  TrendingUp,
  TriangleAlert
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commentOnIncident, listAgents, listIncidents, resolveIncident, updateIncidentStatus } from "@/lib/api";
import { IncidentStreamClient } from "@/lib/incident-stream";
import { useSysPulseStore } from "@/lib/store";
import {
  cn,
  formatIncidentDuration,
  formatLongTimestamp,
  formatRelativeTime,
  getIncidentEventAccent,
  getIncidentSeverityClasses,
  getIncidentStatusClasses,
  titleCase
} from "@/lib/utils";
import type { Agent, Incident, IncidentEvent, IncidentSeverity, IncidentStatus } from "@/types";

export function IncidentsWorkspace() {
  const agents = useSysPulseStore((state) => state.agents);
  const incidents = useSysPulseStore((state) => state.incidents);
  const setAgents = useSysPulseStore((state) => state.setAgents);
  const setIncidents = useSysPulseStore((state) => state.setIncidents);
  const updateIncidentInStore = useSysPulseStore((state) => state.updateIncident);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | IncidentStatus>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | IncidentSeverity>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"comment" | "resolve" | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [recentIncidentIds, setRecentIncidentIds] = useState<string[]>([]);
  const [recentEventIds, setRecentEventIds] = useState<string[]>([]);
  const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const previousTopIncidentIdRef = useRef<string | null>(null);
  const previousSelectedEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [agentList, incidentResponse] = await Promise.all([
          listAgents(),
          listIncidents({ limit: 50, offset: 0 })
        ]);
        if (!active) {
          return;
        }
        setAgents(agentList);
        setIncidents(incidentResponse.incidents);
        setError(null);
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load incidents.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [setAgents, setIncidents]);

  useEffect(() => {
    const client = new IncidentStreamClient({
      onIncident: (incident) => {
        updateIncidentInStore(incident);
      }
    });
    client.connect();
    return () => client.disconnect();
  }, [updateIncidentInStore]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      if (statusFilter !== "all" && incident.status !== statusFilter) {
        return false;
      }
      if (severityFilter !== "all" && incident.severity !== severityFilter) {
        return false;
      }
      if (agentFilter !== "all" && incident.agentId !== agentFilter) {
        return false;
      }
      return true;
    });
  }, [agentFilter, incidents, severityFilter, statusFilter]);

  useEffect(() => {
    if (!selectedIncidentId && filteredIncidents.length > 0) {
      setSelectedIncidentId(filteredIncidents[0]?.id ?? null);
      return;
    }

    if (selectedIncidentId && !filteredIncidents.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0]?.id ?? null);
    }
  }, [filteredIncidents, selectedIncidentId]);

  useEffect(() => {
    const currentTopId = incidents[0]?.id ?? null;
    const previousTopId = previousTopIncidentIdRef.current;
    if (!currentTopId || !previousTopId) {
      previousTopIncidentIdRef.current = currentTopId;
      return;
    }

    if (currentTopId !== previousTopId) {
      const previousIndex = incidents.findIndex((incident) => incident.id === previousTopId);
      const newIncidents = previousIndex > 0 ? incidents.slice(0, previousIndex) : [incidents[0]];
      setRecentIncidentIds(newIncidents.map((incident) => incident.id));
      window.setTimeout(() => setRecentIncidentIds([]), 1200);
    }

    previousTopIncidentIdRef.current = currentTopId;
  }, [incidents]);

  const selectedIncident = filteredIncidents.find((incident) => incident.id === selectedIncidentId) ?? null;
  const selectedTimeline = useMemo(
    () =>
      selectedIncident
        ? selectedIncident.timelineEvents
            .slice()
            .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        : [],
    [selectedIncident]
  );

  useEffect(() => {
    const latestEventId = selectedTimeline.at(-1)?.eventId ?? null;
    if (!latestEventId) {
      previousSelectedEventIdRef.current = null;
      return;
    }

    if (previousSelectedEventIdRef.current && previousSelectedEventIdRef.current !== latestEventId) {
      setRecentEventIds([latestEventId]);
      window.setTimeout(() => setRecentEventIds([]), 1200);
    }

    previousSelectedEventIdRef.current = latestEventId;
    if (timelineRef.current) {
      timelineRef.current.scrollTo({
        top: timelineRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [selectedTimeline]);

  const agentNameById = useMemo<Record<string, string>>(
    () =>
      agents.reduce<Record<string, string>>((accumulator, agent) => {
        accumulator[agent.id] = agent.hostname;
        return accumulator;
      }, {}),
    [agents]
  );

  const handleMarkInvestigating = async () => {
    if (!selectedIncident) {
      return;
    }

    try {
      setIsSubmittingAction(true);
      setActionError(null);
      const updated = await updateIncidentStatus(
        selectedIncident.id,
        "investigating",
        "Investigation started from the dashboard."
      );
      updateIncidentInStore(updated);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Unable to update incident.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!selectedIncident || !actionMode || !commentDraft.trim()) {
      return;
    }

    try {
      setIsSubmittingAction(true);
      setActionError(null);
      const updated =
        actionMode === "comment"
          ? await commentOnIncident(selectedIncident.id, commentDraft.trim())
          : await resolveIncident(selectedIncident.id, commentDraft.trim());
      updateIncidentInStore(updated);
      setCommentDraft("");
      setActionMode(null);
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : "Unable to update incident.");
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Incident Timeline</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Reconstruct what happened, in order</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            SysPulse interleaves spikes, logs, anomalies, forecasts, and operator comments into a
            single timeline so you can move from “something is wrong” to “here is the full story.”
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[0.35fr_0.65fr]">
        <aside className="panel-surface rounded-[30px] border border-slate-800/80 p-4">
          <div className="grid gap-3">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | IncidentStatus)}
              className="h-11 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
            >
              <option value="all" className="bg-slate-950">All statuses</option>
              <option value="open" className="bg-slate-950">Open</option>
              <option value="investigating" className="bg-slate-950">Investigating</option>
              <option value="resolved" className="bg-slate-950">Resolved</option>
            </select>
            <select
              value={severityFilter}
              onChange={(event) => setSeverityFilter(event.target.value as "all" | IncidentSeverity)}
              className="h-11 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
            >
              <option value="all" className="bg-slate-950">All severities</option>
              <option value="low" className="bg-slate-950">Low</option>
              <option value="medium" className="bg-slate-950">Medium</option>
              <option value="high" className="bg-slate-950">High</option>
              <option value="critical" className="bg-slate-950">Critical</option>
            </select>
            <select
              value={agentFilter}
              onChange={(event) => setAgentFilter(event.target.value)}
              className="h-11 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
            >
              <option value="all" className="bg-slate-950">All agents</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id} className="bg-slate-950">
                  {agent.hostname}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-3">
            {filteredIncidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => setSelectedIncidentId(incident.id)}
                className={cn(
                  "w-full rounded-[26px] border px-4 py-4 text-left transition-all",
                  selectedIncidentId === incident.id
                    ? "border-blue-500/30 bg-blue-500/10 shadow-[0_0_24px_rgba(59,130,246,0.12)]"
                    : "border-white/8 bg-white/[0.03] hover:border-white/14"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "mt-1 h-3 w-3 rounded-full",
                        incident.severity === "critical"
                          ? "animate-pulse bg-red-400"
                          : incident.severity === "high"
                            ? "bg-orange-400"
                            : incident.severity === "medium"
                              ? "bg-amber-300"
                              : "bg-slate-400"
                      )}
                    />
                    <div>
                      <p className="line-clamp-2 text-sm font-semibold text-white">{incident.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {agentNameById[incident.agentId] ?? incident.agentId.slice(0, 8)} · {formatRelativeTime(incident.startedAt)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={getIncidentStatusClasses(incident.status)}>
                    {titleCase(incident.status)}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Badge variant="outline" className={getIncidentSeverityClasses(incident.severity)}>
                    {titleCase(incident.severity)}
                  </Badge>
                  {formatIncidentDuration(incident) ? <span>{formatIncidentDuration(incident)}</span> : null}
                </div>

                {recentIncidentIds.includes(incident.id) ? (
                  <div className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-500/8 px-3 py-2 text-xs text-blue-100">
                    Live update received
                  </div>
                ) : null}
              </button>
            ))}

            {!loading && filteredIncidents.length === 0 ? (
              <div className="rounded-[26px] border border-dashed border-white/10 px-4 py-10 text-center">
                <p className="text-lg font-semibold text-white">No incidents match these filters.</p>
                <p className="mt-2 text-sm text-slate-400">
                  Clear a filter or create a manual incident from an agent card.
                </p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="panel-surface rounded-[30px] border border-slate-800/80 p-5">
          {selectedIncident ? (
            <>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-2xl font-semibold text-white">{selectedIncident.title}</h2>
                    <Badge variant="outline" className={getIncidentSeverityClasses(selectedIncident.severity)}>
                      {titleCase(selectedIncident.severity)}
                    </Badge>
                    <Badge variant="outline" className={getIncidentStatusClasses(selectedIncident.status)}>
                      {titleCase(selectedIncident.status)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">
                    {agentNameById[selectedIncident.agentId] ?? selectedIncident.agentId.slice(0, 8)} ·{" "}
                    {formatLongTimestamp(selectedIncident.startedAt)}
                    {selectedIncident.resolvedAt ? ` → ${formatLongTimestamp(selectedIncident.resolvedAt)}` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedIncident.status === "open" ? (
                    <Button variant="outline" onClick={() => void handleMarkInvestigating()} disabled={isSubmittingAction}>
                      Mark Investigating
                    </Button>
                  ) : null}
                  {selectedIncident.status !== "resolved" ? (
                    <Button variant="outline" onClick={() => setActionMode("resolve")}>
                      Resolve
                    </Button>
                  ) : null}
                  <Button variant="outline" onClick={() => setActionMode("comment")}>
                    Add Comment
                  </Button>
                </div>
              </div>

              {selectedIncident.summary ? (
                <div className="mt-6 rounded-[28px] border border-blue-500/24 bg-blue-500/10 px-5 py-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-blue-200">AI Analysis</p>
                  <p className="mt-3 text-sm leading-7 text-blue-50">{selectedIncident.summary}</p>
                </div>
              ) : null}

              {actionMode ? (
                <div className="mt-5 rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white">
                    {actionMode === "resolve" ? "Resolve incident" : "Add a timeline comment"}
                  </p>
                  <textarea
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    rows={4}
                    className="mt-3 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/40"
                    placeholder={
                      actionMode === "resolve"
                        ? "Describe what resolved the incident..."
                        : "Add context for the next operator..."
                    }
                  />
                  {actionError ? (
                    <p className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                      {actionError}
                    </p>
                  ) : null}
                  <div className="mt-4 flex justify-end gap-3">
                    <Button variant="ghost" onClick={() => setActionMode(null)}>
                      Cancel
                    </Button>
                    <Button onClick={() => void handleSubmitComment()} disabled={isSubmittingAction || !commentDraft.trim()}>
                      {isSubmittingAction ? "Saving..." : actionMode === "resolve" ? "Resolve incident" : "Add comment"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div ref={timelineRef} className="mt-6 max-h-[65vh] overflow-y-auto pr-2">
                <div className="relative pl-8">
                  <div className="absolute bottom-0 left-[11px] top-0 w-px bg-white/10" />
                  <div className="space-y-4">
                    {selectedTimeline.map((event) => (
                      <TimelineEventCard
                        key={event.eventId}
                        event={event}
                        expanded={expandedEventIds.includes(event.eventId)}
                        isNew={recentEventIds.includes(event.eventId)}
                        onToggle={() =>
                          setExpandedEventIds((current) =>
                            current.includes(event.eventId)
                              ? current.filter((item) => item !== event.eventId)
                              : [...current, event.eventId]
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[50vh] items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center">
              <div>
                <p className="text-2xl font-semibold text-white">Select an incident</p>
                <p className="mt-3 text-sm text-slate-400">
                  Choose an incident from the left rail to inspect its timeline, AI summary, and operator comments.
                </p>
              </div>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function TimelineEventCard({
  event,
  expanded,
  isNew,
  onToggle
}: {
  event: IncidentEvent;
  expanded: boolean;
  isNew: boolean;
  onToggle: () => void;
}) {
  const accent = getIncidentEventAccent(event.type);
  const Icon = getEventIcon(event.type);

  return (
    <div className="relative">
      <div className={cn("absolute left-[-29px] top-6 h-4 w-4 rounded-full border border-slate-950", accent.dot)} />
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full rounded-[26px] border p-4 text-left transition-all",
          accent.border,
          isNew ? "translate-y-0 opacity-100 shadow-[0_0_30px_rgba(59,130,246,0.12)]" : "",
          expanded ? "border-white/16" : "hover:border-white/14"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-100">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{formatLongTimestamp(event.timestamp)}</p>
              <p className="mt-2 text-base font-semibold text-white">{event.title}</p>
              <p className={cn("mt-2 text-sm leading-6 text-slate-300", expanded ? "" : "line-clamp-2")}>
                {event.detail}
              </p>
            </div>
          </div>
          <Badge variant="outline" className={getIncidentSeverityClasses(event.severity)}>
            {titleCase(event.severity)}
          </Badge>
        </div>

        {event.metricSnapshot ? (
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/10 px-4 py-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
              <span>Metric snapshot</span>
              <span>
                CPU {event.metricSnapshot.cpu.toFixed(0)} · Memory {event.metricSnapshot.memory.toFixed(0)} · Disk{" "}
                {event.metricSnapshot.disk.toFixed(0)}
              </span>
            </div>
            <MetricSparkline snapshot={event.metricSnapshot} />
          </div>
        ) : null}
      </button>
    </div>
  );
}

function MetricSparkline({
  snapshot
}: {
  snapshot: NonNullable<IncidentEvent["metricSnapshot"]>;
}) {
  const points = [snapshot.cpu, snapshot.memory, snapshot.disk];
  const width = 220;
  const height = 56;
  const maxValue = Math.max(...points, 100);
  const path = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (value / maxValue) * height;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-14 w-full">
      <path d={path} fill="none" stroke="rgb(59 130 246)" strokeWidth="3" strokeLinecap="round" />
      {points.map((value, index) => {
        const x = (index / (points.length - 1)) * width;
        const y = height - (value / maxValue) * height;
        return <circle key={`${value}-${index}`} cx={x} cy={y} r="4" fill="rgb(191 219 254)" />;
      })}
    </svg>
  );
}

function getEventIcon(type: IncidentEvent["type"]) {
  switch (type) {
    case "metric_spike":
      return TrendingUp;
    case "log_error":
      return CircleAlert;
    case "anomaly":
      return Bot;
    case "alert_fired":
      return BellRing;
    case "correlation":
      return Link2;
    case "forecast_warning":
      return TriangleAlert;
    case "status_change":
      return CheckCircle2;
    default:
      return MessageSquare;
  }
}
