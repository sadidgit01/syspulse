"use client";

import { useEffect } from "react";

import { getStoredOrgId } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import { MetricsWebSocketClient } from "@/lib/websocket";

export function useWebSocket() {
  const pushMetric = useSysPulseStore((state) => state.pushMetric);
  const setWsStatus = useSysPulseStore((state) => state.setWsStatus);
  const wsStatus = useSysPulseStore((state) => state.wsStatus);

  useEffect(() => {
    const orgId = getStoredOrgId();
    if (!orgId) {
      setWsStatus("disconnected");
      return;
    }

    const client = new MetricsWebSocketClient({
      orgId,
      onMetric: pushMetric,
      onStatusChange: setWsStatus
    });

    client.connect();

    return () => {
      client.disconnect();
    };
  }, [pushMetric, setWsStatus]);

  return wsStatus;
}
