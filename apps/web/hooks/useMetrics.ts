"use client";

import { useSysPulseStore } from "@/lib/store";

export function useMetrics(agentId: string | null) {
  const snapshots = useSysPulseStore((state) => (agentId ? state.metrics[agentId] ?? [] : []));
  const latest = snapshots.at(-1) ?? null;

  return {
    snapshots,
    latest
  };
}
