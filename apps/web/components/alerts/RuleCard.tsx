"use client";

import { BellRing, Link2, Mail, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildAlertConditionSummary, formatRelativeTime, getIncidentSeverityClasses, titleCase } from "@/lib/utils";
import type { AlertRule } from "@/types";

export function RuleCard({
  rule,
  onToggle,
  onDelete
}: {
  rule: AlertRule;
  onToggle: (rule: AlertRule) => void;
  onDelete: (rule: AlertRule) => void;
}) {
  return (
    <Card className="panel-surface panel-hover rounded-3xl border border-slate-800/80">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-white">{rule.name}</p>
            <p className="mt-1 text-sm text-slate-400">
              {rule.description || buildAlertConditionSummary(rule.conditionType, rule.condition)}
            </p>
          </div>
          <Badge variant="outline" className={getIncidentSeverityClasses(rule.severity)}>
            {titleCase(rule.severity)}
          </Badge>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          {buildAlertConditionSummary(rule.conditionType, rule.condition)}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {rule.channels.map((channel, index) => {
            const Icon =
              channel.type === "email"
                ? Mail
                : channel.type === "webhook"
                  ? Link2
                  : BellRing;
            return (
              <span
                key={`${channel.type}-${index}`}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300"
              >
                <Icon className="h-3.5 w-3.5" />
                {titleCase(channel.type)}
              </span>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-sm text-slate-400">
            <p>Last fired {rule.lastFiredAt ? formatRelativeTime(rule.lastFiredAt) : "never"}</p>
            <p>Cooldown {rule.cooldownMinutes} minutes</p>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={rule.isEnabled}
                onChange={() => onToggle(rule)}
                className="h-4 w-4 rounded border-white/12 bg-white/5 accent-blue-500"
              />
              {rule.isEnabled ? "Enabled" : "Disabled"}
            </label>
            <Button variant="ghost" size="icon" onClick={() => onDelete(rule)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
