import { TraceExplorer } from "@/components/traces/TraceExplorer";

export default async function TraceDetailPage({
  params
}: {
  params: Promise<{ traceId: string }>;
}) {
  const { traceId } = await params;
  return <TraceExplorer initialTraceId={traceId} />;
}
