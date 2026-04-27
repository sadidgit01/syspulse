"use client";

import { Activity, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getTraceDetail, listTraces } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Span, TraceDetail, TraceListItem } from "@/types";

interface TraceExplorerProps {
  initialTraceId?: string;
}

interface RenderedSpan {
  span: Span;
  depth: number;
  x: number;
  y: number;
  width: number;
}

const rowHeight = 34;
const labelColumnWidth = 260;
const minBarWidth = 4;

export function TraceExplorer({ initialTraceId }: TraceExplorerProps) {
  const router = useRouter();
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState(initialTraceId ?? "");
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<Span | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoadingList(true);
      setError(null);
      try {
        const nextTraces = await listTraces({
          service: "syspulse-api",
          limit: 40,
          search,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to).toISOString() : undefined
        });
        if (cancelled) {
          return;
        }
        setTraces(nextTraces);
        if (!selectedTraceId && nextTraces[0]) {
          setSelectedTraceId(nextTraces[0].traceId);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load traces.");
          setTraces([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [from, search, selectedTraceId, to]);

  useEffect(() => {
    if (!selectedTraceId) {
      setTraceDetail(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoadingDetail(true);
      try {
        const detail = await getTraceDetail(selectedTraceId);
        if (!cancelled) {
          setTraceDetail(detail);
          setHoveredSpan(detail.spans[0] ?? null);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load trace detail.");
          setTraceDetail(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedTraceId]);

  const handleSelectTrace = (traceId: string) => {
    setSelectedTraceId(traceId);
    router.push(`/dashboard/traces/${traceId}`);
  };

  const selectedTrace = traces.find((trace) => trace.traceId === selectedTraceId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-3">
          <Badge
            className="border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-blue-200"
            variant="outline"
          >
            Distributed Tracing
          </Badge>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Follow every slow request from HTTP edge to SQL, Redis, and AI work.
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
              Jaeger traces are normalized into a SysPulse waterfall so an API call can be
              tied back to exact spans, attributes, status, and timing.
            </p>
          </div>
        </div>

        <Card className="panel-surface rounded-[28px] border border-slate-800/80 xl:w-[390px]">
          <CardContent className="grid gap-3 p-4 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <span className="text-slate-400">Selected trace</span>
              <span className="max-w-[170px] truncate font-mono text-blue-100">
                {selectedTraceId || "waiting"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
              <span className="text-slate-400">Span count</span>
              <span className="font-mono text-white">{traceDetail?.spans.length ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="panel-surface rounded-[28px] border border-slate-800/80">
        <CardContent className="grid gap-4 p-4 md:grid-cols-[1.2fr_0.7fr_0.7fr_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search operation, service, or trace id..."
              className="pl-11"
            />
          </label>
          <Input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Trace range from"
          />
          <Input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Trace range to"
          />
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setFrom(defaultFrom());
              setTo(defaultTo());
            }}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-3xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[0.72fr_1fr]">
        <TraceList
          traces={traces}
          loading={loadingList}
          selectedTraceId={selectedTraceId}
          onSelect={handleSelectTrace}
        />
        <TraceWaterfall
          trace={traceDetail}
          selectedTrace={selectedTrace}
          hoveredSpan={hoveredSpan}
          loading={loadingDetail}
          onHoverSpan={setHoveredSpan}
        />
      </div>
    </div>
  );
}

function TraceList({
  traces,
  loading,
  selectedTraceId,
  onSelect
}: {
  traces: TraceListItem[];
  loading: boolean;
  selectedTraceId: string;
  onSelect: (traceId: string) => void;
}) {
  return (
    <Card className="panel-surface rounded-[28px] border border-slate-800/80">
      <CardContent className="p-0">
        <div className="border-b border-white/6 p-5">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trace List</p>
          <p className="mt-2 text-sm text-slate-400">
            {loading ? "Loading traces..." : `${traces.length} traces in the current window`}
          </p>
        </div>
        <div className="max-h-[680px] overflow-y-auto p-3">
          {traces.length === 0 && !loading ? (
            <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-6 text-sm text-slate-400">
              No traces found. Generate a few API calls, then refresh this range.
            </div>
          ) : null}

          {traces.map((trace) => (
            <button
              key={trace.traceId}
              type="button"
              onClick={() => onSelect(trace.traceId)}
              className={cn(
                "mb-3 w-full rounded-3xl border p-4 text-left transition-all",
                selectedTraceId === trace.traceId
                  ? "border-blue-500/40 bg-blue-500/10 shadow-[0_0_30px_rgba(59,130,246,0.12)]"
                  : "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{trace.operationName}</p>
                  <p className="mt-1 text-xs text-slate-500">{trace.serviceName}</p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 border px-2.5 py-1 text-[11px]",
                    trace.hasError
                      ? "border-red-500/30 bg-red-500/10 text-red-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  )}
                >
                  {trace.hasError ? "error" : "ok"}
                </Badge>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <MetricPill label="Duration" value={formatDuration(trace.duration)} tone={durationTone(trace.duration)} />
                <MetricPill label="Spans" value={String(trace.spanCount)} tone="slate" />
                <MetricPill label="Time" value={formatClock(trace.startTime)} tone="slate" />
              </div>
              <p className="mt-3 truncate font-mono text-[11px] text-slate-500">{trace.traceId}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TraceWaterfall({
  trace,
  selectedTrace,
  hoveredSpan,
  loading,
  onHoverSpan
}: {
  trace: TraceDetail | null;
  selectedTrace: TraceListItem | null;
  hoveredSpan: Span | null;
  loading: boolean;
  onHoverSpan: (span: Span | null) => void;
}) {
  const renderedSpans = useMemo(() => (trace ? layoutSpans(trace.spans) : []), [trace]);
  const width = 960;
  const height = Math.max(240, renderedSpans.length * rowHeight + 60);

  return (
    <Card className="panel-surface rounded-[28px] border border-slate-800/80">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 border-b border-white/6 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Waterfall</p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              {selectedTrace?.operationName ?? "Select a trace"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetricPill
              label="Duration"
              value={formatDuration(selectedTrace?.duration ?? 0)}
              tone={durationTone(selectedTrace?.duration ?? 0)}
            />
            <MetricPill label="Start" value={selectedTrace ? formatClock(selectedTrace.startTime) : "--"} tone="slate" />
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8 text-sm text-slate-400">
            Loading trace detail...
          </div>
        ) : null}

        {!loading && trace && trace.spans.length > 0 ? (
          <div className="grid gap-4 2xl:grid-cols-[1fr_310px]">
            <div className="overflow-x-auto rounded-3xl border border-white/8 bg-[#050812]/80 p-4">
              <svg
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label="Trace waterfall"
                className="min-w-[860px]"
              >
                <defs>
                  <linearGradient id="trace-fast" x1="0" x2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity="0.92" />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity="0.54" />
                  </linearGradient>
                  <linearGradient id="trace-warm" x1="0" x2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.94" />
                    <stop offset="100%" stopColor="#f97316" stopOpacity="0.56" />
                  </linearGradient>
                  <linearGradient id="trace-slow" x1="0" x2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity="0.96" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.58" />
                  </linearGradient>
                </defs>
                <line x1={labelColumnWidth} x2={labelColumnWidth} y1="18" y2={height - 18} stroke="rgba(148,163,184,0.16)" />
                {renderedSpans.map(({ span, depth, x, y, width: barWidth }) => (
                  <g
                    key={span.spanId}
                    onMouseEnter={() => onHoverSpan(span)}
                    onMouseLeave={() => onHoverSpan(null)}
                    className="cursor-pointer"
                  >
                    <text
                      x={16 + depth * 18}
                      y={y + 18}
                      fill="rgb(203,213,225)"
                      fontSize="12"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    >
                      {truncateSpanLabel(span.operationName, 32 - depth * 2)}
                    </text>
                    <rect
                      x={x}
                      y={y}
                      width={Math.max(barWidth, minBarWidth)}
                      height={18}
                      rx={9}
                      fill={`url(#${durationGradient(span.duration)})`}
                      stroke={span.tags.error === true || span.tags.error === "true" ? "rgba(248,113,113,0.8)" : "rgba(255,255,255,0.12)"}
                    />
                    <text
                      x={x + Math.max(barWidth, minBarWidth) + 8}
                      y={y + 14}
                      fill="rgb(148,163,184)"
                      fontSize="11"
                    >
                      {formatDuration(span.duration)}
                    </text>
                    <title>{spanTooltip(span)}</title>
                  </g>
                ))}
              </svg>
            </div>
            <SpanInspector span={hoveredSpan ?? trace.spans[0]} />
          </div>
        ) : null}

        {!loading && (!trace || trace.spans.length === 0) ? (
          <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-8 text-sm text-slate-400">
            Select a trace to inspect its nested spans.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SpanInspector({ span }: { span: Span | null }) {
  if (!span) {
    return null;
  }

  const attributes = Object.entries(span.tags).slice(0, 14);
  return (
    <aside className="rounded-3xl border border-white/8 bg-white/[0.035] p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-200">
          <Activity className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{span.operationName}</p>
          <p className="mt-1 text-xs text-slate-500">{span.serviceName}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <MetricPill label="Duration" value={formatDuration(span.duration)} tone={durationTone(span.duration)} />
        <MetricPill label="Start" value={formatClock(span.startTime)} tone="slate" />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attributes</p>
        {attributes.length === 0 ? (
          <p className="rounded-2xl border border-white/8 bg-black/20 p-3 text-xs text-slate-500">
            No span attributes recorded.
          </p>
        ) : (
          attributes.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[0.9fr_1.1fr] gap-3 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-xs"
            >
              <span className="truncate text-slate-500">{key}</span>
              <span className="truncate font-mono text-slate-200">{String(value)}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function MetricPill({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "slate";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-2",
        tone === "green" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
        tone === "amber" && "border-amber-500/20 bg-amber-500/10 text-amber-200",
        tone === "red" && "border-red-500/20 bg-red-500/10 text-red-200",
        tone === "slate" && "border-white/8 bg-white/[0.03] text-slate-200"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-1 font-mono text-xs font-semibold">{value}</p>
    </div>
  );
}

function layoutSpans(spans: Span[]): RenderedSpan[] {
  if (spans.length === 0) {
    return [];
  }

  const sorted = spans.slice().sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
  const childrenByParent = new Map<string | null, Span[]>();
  for (const span of sorted) {
    const key = span.parentSpanId ?? null;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), span]);
  }

  const ordered: Array<{ span: Span; depth: number }> = [];
  const visit = (span: Span, depth: number) => {
    ordered.push({ span, depth });
    for (const child of childrenByParent.get(span.spanId) ?? []) {
      visit(child, depth + 1);
    }
  };

  const roots = childrenByParent.get(null) ?? [sorted[0]];
  for (const root of roots) {
    visit(root, 0);
  }

  const traceStart = Math.min(...sorted.map((span) => Date.parse(span.startTime)));
  const traceEnd = Math.max(...sorted.map((span) => Date.parse(span.startTime) + span.duration));
  const duration = Math.max(traceEnd - traceStart, 1);
  const chartWidth = 640;

  return ordered.map(({ span, depth }, index) => {
    const startOffset = Date.parse(span.startTime) - traceStart;
    return {
      span,
      depth,
      x: labelColumnWidth + 18 + (startOffset / duration) * chartWidth,
      y: 30 + index * rowHeight,
      width: (span.duration / duration) * chartWidth
    };
  });
}

function durationTone(duration: number): "green" | "amber" | "red" {
  if (duration < 100) {
    return "green";
  }
  if (duration <= 500) {
    return "amber";
  }
  return "red";
}

function durationGradient(duration: number): string {
  const tone = durationTone(duration);
  if (tone === "green") {
    return "trace-fast";
  }
  if (tone === "amber") {
    return "trace-warm";
  }
  return "trace-slow";
}

function spanTooltip(span: Span): string {
  const attributes = Object.entries(span.tags)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
  return `${span.operationName}\n${formatDuration(span.duration)}\n${attributes}`;
}

function formatDuration(duration: number): string {
  if (duration < 1000) {
    return `${duration.toFixed(duration < 10 ? 1 : 0)}ms`;
  }
  return `${(duration / 1000).toFixed(2)}s`;
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function truncateSpanLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(4, maxLength - 1))}…`;
}

function defaultFrom(): string {
  return toDateTimeLocal(new Date(Date.now() - 60 * 60 * 1000));
}

function defaultTo(): string {
  return toDateTimeLocal(new Date());
}

function toDateTimeLocal(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}
