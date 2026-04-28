import type { Span, SpanLog, SpanLogField, TraceDetail, TraceListItem } from "@/types";

const DEFAULT_JAEGER_URLS = [
  process.env.JAEGER_QUERY_URL,
  "http://127.0.0.1:16686",
  "http://localhost:16686",
  "http://jaeger:16686"
]
  .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  .map((value) => value.replace(/\/$/, ""));

interface JaegerTag {
  key?: unknown;
  value?: unknown;
}

interface JaegerLog {
  timestamp?: unknown;
  fields?: unknown;
}

interface JaegerReference {
  refType?: unknown;
  spanID?: unknown;
}

interface JaegerSpan {
  traceID?: unknown;
  spanID?: unknown;
  operationName?: unknown;
  processID?: unknown;
  references?: unknown;
  startTime?: unknown;
  duration?: unknown;
  tags?: unknown;
  logs?: unknown;
}

interface JaegerProcess {
  serviceName?: unknown;
}

interface JaegerTrace {
  traceID?: unknown;
  spans?: unknown;
  processes?: unknown;
}

export async function fetchJaegerTraceList(query: URLSearchParams): Promise<TraceListItem[]> {
  const service = query.get("service") ?? "syspulse-api";
  const limit = query.get("limit") ?? "20";
  const search = (query.get("search") ?? "").trim().toLowerCase();
  const jaegerQuery = new URLSearchParams({ service, limit });

  const from = query.get("from");
  const to = query.get("to");
  if (from) {
    jaegerQuery.set("start", String(dateToMicroseconds(from)));
  }
  if (to) {
    jaegerQuery.set("end", String(dateToMicroseconds(to)));
  }

  const response = await fetchFromJaeger(`/api/traces?${jaegerQuery.toString()}`);
  const traces = extractTraceArray(await response.json());
  return traces
    .map(traceToListItem)
    .filter((trace) => {
      if (!search) {
        return true;
      }
      return (
        trace.operationName.toLowerCase().includes(search) ||
        trace.serviceName.toLowerCase().includes(search) ||
        trace.traceId.toLowerCase().includes(search)
      );
    })
    .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime));
}

export async function fetchJaegerTraceDetail(traceId: string): Promise<TraceDetail> {
  const response = await fetchFromJaeger(`/api/traces/${encodeURIComponent(traceId)}`);
  const traces = extractTraceArray(await response.json());
  const trace = traces[0];
  if (!trace) {
    return { traceId, spans: [] };
  }
  return traceToDetail(trace);
}

async function fetchFromJaeger(path: string): Promise<Response> {
  const errors: string[] = [];

  for (const baseUrl of DEFAULT_JAEGER_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        errors.push(`${baseUrl} returned ${response.status}`);
        continue;
      }
      return response;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown fetch error";
      errors.push(`${baseUrl} failed: ${detail}`);
    }
  }

  throw new Error(
    `Jaeger is unreachable. Checked ${DEFAULT_JAEGER_URLS.join(", ")}. ${errors.join(" | ")}`
  );
}

function extractTraceArray(payload: unknown): JaegerTrace[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(isRecord).map((entry) => entry as JaegerTrace);
}

function traceToListItem(trace: JaegerTrace): TraceListItem {
  const spans = getSpans(trace);
  const detail = traceToDetail(trace);
  const rootSpan = findRootSpan(detail.spans) ?? detail.spans[0];
  const serviceName = rootSpan?.serviceName ?? "unknown-service";
  const operationName = rootSpan?.operationName ?? "unknown-operation";
  const startTime = rootSpan?.startTime ?? new Date().toISOString();
  const duration = detail.spans.length > 0 ? getTraceDuration(detail.spans) : 0;

  return {
    traceId: stringValue(trace.traceID, rootSpan?.spanId ?? "unknown-trace"),
    serviceName,
    operationName,
    duration,
    startTime,
    spanCount: spans.length,
    hasError: detail.spans.some((span) => span.tags.error === true || span.tags.error === "true")
  };
}

function traceToDetail(trace: JaegerTrace): TraceDetail {
  const processes = getProcesses(trace);
  const spans = getSpans(trace)
    .map((span): Span => {
      const processId = stringValue(span.processID, "");
      const serviceName = stringValue(processes[processId]?.serviceName, "unknown-service");
      return {
        spanId: stringValue(span.spanID, "unknown-span"),
        parentSpanId: getParentSpanId(span),
        operationName: stringValue(span.operationName, "unknown-operation"),
        serviceName,
        startTime: microsecondsToIso(numberValue(span.startTime, 0)),
        duration: microsecondsToMilliseconds(numberValue(span.duration, 0)),
        tags: tagsToRecord(span.tags),
        logs: logsToList(span.logs)
      };
    })
    .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));

  return {
    traceId: stringValue(trace.traceID, spans[0]?.spanId ?? "unknown-trace"),
    spans
  };
}

function getSpans(trace: JaegerTrace): JaegerSpan[] {
  return Array.isArray(trace.spans)
    ? trace.spans.filter(isRecord).map((span) => span as JaegerSpan)
    : [];
}

function getProcesses(trace: JaegerTrace): Record<string, JaegerProcess> {
  if (!isRecord(trace.processes)) {
    return {};
  }

  const result: Record<string, JaegerProcess> = {};
  for (const [key, value] of Object.entries(trace.processes)) {
    if (isRecord(value)) {
      result[key] = value as JaegerProcess;
    }
  }
  return result;
}

function getParentSpanId(span: JaegerSpan): string | null {
  if (!Array.isArray(span.references)) {
    return null;
  }
  const childReference = span.references
    .filter(isRecord)
    .map((reference) => reference as JaegerReference)
    .find((reference) => stringValue(reference.refType, "") === "CHILD_OF");
  return childReference ? stringValue(childReference.spanID, null) : null;
}

function tagsToRecord(tags: unknown): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  if (!Array.isArray(tags)) {
    return result;
  }

  for (const tag of tags.filter(isRecord).map((entry) => entry as JaegerTag)) {
    const key = stringValue(tag.key, "");
    if (!key) {
      continue;
    }
    result[key] = primitiveValue(tag.value);
  }
  return result;
}

function logsToList(logs: unknown): SpanLog[] {
  if (!Array.isArray(logs)) {
    return [];
  }

  return logs.filter(isRecord).map((log): SpanLog => {
    const entry = log as JaegerLog;
    return {
      timestamp: microsecondsToIso(numberValue(entry.timestamp, 0)),
      fields: logFieldsToList(entry.fields)
    };
  });
}

function logFieldsToList(fields: unknown): SpanLogField[] {
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields
    .filter(isRecord)
    .map((field) => field as JaegerTag)
    .map((field) => ({
      key: stringValue(field.key, ""),
      value: primitiveValue(field.value)
    }))
    .filter((field) => field.key.length > 0);
}

function findRootSpan(spans: Span[]): Span | null {
  return spans.find((span) => span.parentSpanId === null) ?? null;
}

function getTraceDuration(spans: Span[]): number {
  const starts = spans.map((span) => Date.parse(span.startTime));
  const ends = spans.map((span) => Date.parse(span.startTime) + span.duration);
  return Math.max(...ends) - Math.min(...starts);
}

function dateToMicroseconds(value: string): number {
  return Date.parse(value) * 1000;
}

function microsecondsToMilliseconds(value: number): number {
  return value / 1000;
}

function microsecondsToIso(value: number): string {
  if (value <= 0) {
    return new Date(0).toISOString();
  }
  return new Date(Math.floor(value / 1000)).toISOString();
}

function stringValue(value: unknown, fallback: string): string;
function stringValue(value: unknown, fallback: null): string | null;
function stringValue(value: unknown, fallback: string | null): string | null {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function primitiveValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
