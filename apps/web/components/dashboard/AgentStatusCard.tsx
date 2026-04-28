"use client";

import { Cpu, FileWarning, HardDrive, MemoryStick, SignalHigh } from "lucide-react";
import { useEffect, useState } from "react";

import { AnomalyDetailModal } from "@/components/ai/AnomalyDetailModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createIncident } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import { cn, formatRelativeTime, getAgentToneClasses, titleCase } from "@/lib/utils";
import type { Agent, AnomalyEvent, IncidentSeverity, MetricSnapshot } from "@/types";

export function AgentStatusCard({
  agent,
  latestMetric,
  latestAnomaly,
  isActive,
  onSelect,
  onCorrelate
}: {
  agent: Agent;
  latestMetric: MetricSnapshot | null;
  latestAnomaly: AnomalyEvent | null;
  isActive: boolean;
  onSelect: (agentId: string) => void;
  onCorrelate: (agent: Agent) => void;
}) {
  const addIncident = useSysPulseStore((state) => state.addIncident);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTitle, setReportTitle] = useState(`Incident on ${agent.hostname}`);
  const [reportSeverity, setReportSeverity] = useState<IncidentSeverity>("medium");
  const [reportComment, setReportComment] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toneClasses = getAgentToneClasses(agent.lastSeen);

  useEffect(() => {
    if (!reportOpen) {
      setReportTitle(`Incident on ${agent.hostname}`);
      setReportSeverity("medium");
      setReportComment("");
      setReportError(null);
      setIsSubmitting(false);
    }
  }, [agent.hostname, reportOpen]);

  const handleSubmitReport = async () => {
    if (!reportComment.trim()) {
      setReportError("Add a short comment so the incident has context.");
      return;
    }

    try {
      setIsSubmitting(true);
      setReportError(null);
      const incident = await createIncident({
        agentId: agent.id,
        title: reportTitle.trim(),
        severity: reportSeverity,
        comment: reportComment.trim()
      });
      addIncident(incident);
      setReportOpen(false);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : "Unable to create incident.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Card
        className={cn(
          "panel-surface panel-hover h-full cursor-pointer rounded-3xl border p-0",
          isActive
            ? "border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.16)]"
            : "border-slate-800/80"
        )}
        onClick={() => onSelect(agent.id)}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <p className="truncate text-lg font-semibold text-white">{agent.hostname}</p>
                {latestAnomaly ? (
                  <button
                    type="button"
                    aria-label="Open anomaly detail"
                    title="Open anomaly detail"
                    className="inline-flex h-4 w-4 items-center justify-center"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailsOpen(true);
                    }}
                  >
                    <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {agent.os} · {agent.arch}
              </p>
            </div>

            <Badge
              className={cn("border px-2.5 py-1 uppercase tracking-[0.18em]", toneClasses.badge)}
              variant="outline"
            >
              {toneClasses.label}
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <MetricTile
              icon={Cpu}
              label="CPU"
              value={latestMetric ? `${latestMetric.cpuPercent.toFixed(0)}%` : "--"}
            />
            <MetricTile
              icon={MemoryStick}
              label="Memory"
              value={latestMetric ? `${latestMetric.memoryPercent.toFixed(0)}%` : "--"}
            />
            <MetricTile
              icon={HardDrive}
              label="Disk"
              value={latestMetric ? `${latestMetric.diskPercent.toFixed(0)}%` : "--"}
            />
            <MetricTile icon={SignalHigh} label="Last seen" value={formatRelativeTime(agent.lastSeen)} />
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                setReportOpen(true);
              }}
            >
              <FileWarning className="mr-2 h-4 w-4" />
              Report Incident
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onCorrelate(agent);
              }}
            >
              Correlate
            </Button>
          </div>
        </CardContent>
      </Card>

      <AnomalyDetailModal
        agent={agent}
        anomaly={latestAnomaly}
        open={detailsOpen && latestAnomaly !== null}
        onClose={() => setDetailsOpen(false)}
      />

      {reportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/76 p-4 backdrop-blur-sm"
          onClick={() => setReportOpen(false)}
        >
          <div
            className="panel-surface w-full max-w-xl rounded-[28px] border border-slate-800/80 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Manual Incident</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{agent.hostname}</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setReportOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Title</span>
                <Input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} />
              </label>

              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Severity</span>
                <select
                  value={reportSeverity}
                  onChange={(event) => setReportSeverity(event.target.value as IncidentSeverity)}
                  className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
                >
                  {(["low", "medium", "high", "critical"] as IncidentSeverity[]).map((severity) => (
                    <option key={severity} value={severity} className="bg-slate-950">
                      {titleCase(severity)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm text-slate-300">Comment</span>
                <textarea
                  value={reportComment}
                  onChange={(event) => setReportComment(event.target.value)}
                  rows={5}
                  className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/40"
                  placeholder="What happened on this agent?"
                />
              </label>

              {reportError ? (
                <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                  {reportError}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setReportOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSubmitReport()} disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Incident"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
