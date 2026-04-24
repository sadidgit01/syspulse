"use client";

import { useEffect } from "react";

import { useSysPulseStore } from "@/lib/store";
import { MetricsWebSocketClient } from "@/lib/websocket";

export function useWebSocket(orgId: string | null) {
  const pushMetric = useSysPulseStore((state) => state.pushMetric);
  const setWsStatus = useSysPulseStore((state) => state.setWsStatus);
  const wsStatus = useSysPulseStore((state) => state.wsStatus);

  useEffect(() => {
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
  }, [orgId, pushMetric, setWsStatus]);

  return wsStatus;
}
