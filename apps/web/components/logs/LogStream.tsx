"use client";

import { useEffect, useRef, useState } from "react";

import { LogStreamClient } from "@/lib/log-stream";
import { useSysPulseStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { LogRow } from "@/components/logs/LogRow";
import type { Agent, LogEntry } from "@/types";

const ROW_HEIGHT = 118;
const OVERSCAN = 6;

export function LogStream({
  agents,
  loading,
  error
}: {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}) {
  const logs = useSysPulseStore((state) => state.logs);
  const addLog = useSysPulseStore((state) => state.addLog);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousTopIdRef = useRef<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [autoFollow, setAutoFollow] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(720);
  const [scrollTop, setScrollTop] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    const client = new LogStreamClient({
      onLog: addLog
    });
    client.connect();
    return () => client.disconnect();
  }, [addLog]);

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setViewportHeight(containerRef.current.clientHeight);
      }
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  useEffect(() => {
    const currentTopId = logs[0]?.id ?? null;
    const previousTopId = previousTopIdRef.current;
    if (!currentTopId || !previousTopId) {
      previousTopIdRef.current = currentTopId;
      return;
    }

    if (currentTopId !== previousTopId) {
      const previousIndex = logs.findIndex((entry) => entry.id === previousTopId);
      const newItems = previousIndex > 0 ? logs.slice(0, previousIndex) : [logs[0]];
      setRecentIds(newItems.map((entry) => entry.id));
      window.setTimeout(() => setRecentIds([]), 900);

      if (autoFollow && containerRef.current) {
        containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        setUnseenCount(0);
      } else {
        setUnseenCount((count) => count + newItems.length);
      }
    }

    previousTopIdRef.current = currentTopId;
  }, [autoFollow, logs]);

  const handleScroll = () => {
    const nextScrollTop = containerRef.current?.scrollTop ?? 0;
    setScrollTop(nextScrollTop);
    if (nextScrollTop <= 24) {
      setAutoFollow(true);
      setUnseenCount(0);
      return;
    }

    setAutoFollow(false);
  };

  const totalHeight = logs.length * ROW_HEIGHT;
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(logs.length, startIndex + visibleCount + OVERSCAN * 2);
  const visibleLogs = logs.slice(startIndex, endIndex);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, totalHeight - topSpacer - visibleLogs.length * ROW_HEIGHT);

  return (
    <div className="relative flex h-[calc(100vh-13.5rem)] flex-col overflow-hidden rounded-[30px] border border-white/8 bg-black/10">
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Live log lane</p>
          <p className="text-xs text-slate-500">Newest entries arrive at the top in real time.</p>
        </div>

        <label className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={(event) => {
              const checked = event.target.checked;
              setAutoFollow(checked);
              if (checked && containerRef.current) {
                containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
                setUnseenCount(0);
              }
            }}
            className="h-4 w-4 rounded border-white/16 bg-white/5 accent-blue-500"
          />
          Auto-follow
        </label>
      </div>

      {unseenCount > 0 ? (
        <div className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2">
          <Button
            className="pointer-events-auto shadow-[0_12px_30px_rgba(59,130,246,0.28)]"
            size="sm"
            onClick={() => {
              containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
              setAutoFollow(true);
              setUnseenCount(0);
            }}
          >
            {unseenCount} new log{unseenCount === 1 ? "" : "s"}
          </Button>
        </div>
      ) : null}

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <StatePanel message="Loading logs..." />
        ) : error ? (
          <StatePanel message={error} danger />
        ) : logs.length === 0 ? (
          <StatePanel message="No logs match the current filters." />
        ) : (
          <div style={{ paddingTop: topSpacer, paddingBottom: bottomSpacer }} className="space-y-3">
            {visibleLogs.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                agentName={resolveAgentName(agents, entry)}
                expanded={expandedIds.includes(entry.id)}
                isNew={recentIds.includes(entry.id)}
                onToggle={() =>
                  setExpandedIds((current) =>
                    current.includes(entry.id)
                      ? current.filter((id) => id !== entry.id)
                      : [...current, entry.id]
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function resolveAgentName(agents: Agent[], entry: LogEntry): string {
  return agents.find((agent) => agent.id === entry.agentId)?.hostname ?? entry.agentId.slice(0, 8);
}

function StatePanel({ message, danger = false }: { message: string; danger?: boolean }) {
  return (
    <div
      className={
        danger
          ? "flex h-full min-h-80 items-center justify-center rounded-[28px] border border-red-500/20 bg-red-500/8 px-6 text-center text-sm text-red-200"
          : "flex h-full min-h-80 items-center justify-center rounded-[28px] border border-white/8 bg-white/[0.03] px-6 text-center text-sm text-slate-400"
      }
    >
      {message}
    </div>
  );
}
