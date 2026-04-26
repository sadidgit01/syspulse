"use client";

import { useCallback } from "react";

import { useSysPulseStore } from "@/lib/store";
import type { MetricSnapshot } from "@/types";

const EMPTY_SNAPSHOTS: MetricSnapshot[] = [];

export function useMetrics(agentId: string | null) {
  const snapshots = useSysPulseStore(
    useCallback(
      (state) => (agentId ? state.metrics[agentId] ?? EMPTY_SNAPSHOTS : EMPTY_SNAPSHOTS),
      [agentId]
    )
  );
  const latest = snapshots.at(-1) ?? null;

  return {
    snapshots,
    latest
  };
}
