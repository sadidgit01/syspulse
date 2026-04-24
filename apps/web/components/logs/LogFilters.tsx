"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDateTimeInputValue, getLogLevelBadgeClasses } from "@/lib/utils";
import type { Agent, LogFilters, LogLevel } from "@/types";

const LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

export function LogFiltersBar({
  agents,
  filters,
  onChange,
  onClear
}: {
  agents: Agent[];
  filters: LogFilters;
  onChange: (next: Partial<LogFilters>) => void;
  onClear: () => void;
}) {
  const [sourceInput, setSourceInput] = useState(filters.source);
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    setSourceInput(filters.source);
  }, [filters.source]);

  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (sourceInput !== filters.source) {
        onChange({ source: sourceInput });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.source, onChange, sourceInput]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== filters.search) {
        onChange({ search: searchInput });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.search, onChange, searchInput]);

  return (
    <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
      <div className="grid gap-3 xl:grid-cols-[180px_1fr_1fr_180px_180px_auto]">
        <select
          value={filters.agentId}
          onChange={(event) => onChange({ agentId: event.target.value })}
          className="h-12 rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
        >
          <option value="">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.hostname}
            </option>
          ))}
        </select>

        <Input
          value={sourceInput}
          onChange={(event) => setSourceInput(event.target.value)}
          placeholder="Filter by source"
        />

        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search message content"
        />

        <Input
          type="datetime-local"
          value={filters.from ? formatDateTimeInputValue(filters.from) : ""}
          onChange={(event) =>
            onChange({
              from: event.target.value ? new Date(event.target.value).toISOString() : ""
            })
          }
        />

        <Input
          type="datetime-local"
          value={filters.to ? formatDateTimeInputValue(filters.to) : ""}
          onChange={(event) =>
            onChange({
              to: event.target.value ? new Date(event.target.value).toISOString() : ""
            })
          }
        />

        <Button variant="outline" onClick={onClear}>
          Clear
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {LEVELS.map((level) => {
          const isSelected = filters.levels.includes(level);
          return (
            <button
              key={level}
              type="button"
              onClick={() =>
                onChange({
                  levels: isSelected
                    ? filters.levels.filter((entry) => entry !== level)
                    : [...filters.levels, level]
                })
              }
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition",
                isSelected
                  ? getLogLevelBadgeClasses(level)
                  : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/16 hover:text-white"
              )}
            >
              {level}
            </button>
          );
        })}
      </div>
    </div>
  );
}
