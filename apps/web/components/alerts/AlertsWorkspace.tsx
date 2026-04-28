"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { RuleBuilder } from "@/components/alerts/RuleBuilder";
import { RuleCard } from "@/components/alerts/RuleCard";
import { Button } from "@/components/ui/button";
import { listAlertRules, deleteAlertRule, updateAlertRule } from "@/lib/api";
import { useSysPulseStore } from "@/lib/store";
import type { AlertRule } from "@/types";

export function AlertsWorkspace() {
  const alertRules = useSysPulseStore((state) => state.alertRules);
  const setAlertRules = useSysPulseStore((state) => state.setAlertRules);
  const upsertAlertRule = useSysPulseStore((state) => state.upsertAlertRule);
  const removeAlertRule = useSysPulseStore((state) => state.removeAlertRule);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadRules = async () => {
      try {
        const rules = await listAlertRules();
        if (active) {
          setAlertRules(rules);
          setError(null);
        }
      } catch (nextError) {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load alert rules.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadRules();

    return () => {
      active = false;
    };
  }, [setAlertRules]);

  const handleToggle = async (rule: AlertRule) => {
    try {
      const updated = await updateAlertRule(rule.id, {
        isEnabled: !rule.isEnabled
      });
      upsertAlertRule(updated);
      setToast(`${updated.name} ${updated.isEnabled ? "enabled" : "disabled"}.`);
    } catch (nextError) {
      setToast(nextError instanceof Error ? nextError.message : "Unable to update rule.");
    }
  };

  const handleDelete = async (rule: AlertRule) => {
    if (!window.confirm(`Delete "${rule.name}"?`)) {
      return;
    }

    try {
      await deleteAlertRule(rule.id);
      removeAlertRule(rule.id);
      setToast(`${rule.name} deleted.`);
    } catch (nextError) {
      setToast(nextError instanceof Error ? nextError.message : "Unable to delete rule.");
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Alert Rules</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Build your operator playbook</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Compose threshold, relative, composite, and AI-driven alert rules without writing
            code, then route the notifications wherever your team already works.
          </p>
        </div>

        <Button onClick={() => setBuilderOpen(true)}>
          <BellRing className="mr-2 h-4 w-4" />
          Create Rule
        </Button>
      </section>

      {toast ? (
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          {toast}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        {alertRules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} onToggle={handleToggle} onDelete={handleDelete} />
        ))}

        {!loading && alertRules.length === 0 ? (
          <div className="panel-surface rounded-[28px] border border-dashed border-slate-800/80 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-white">No rules yet</p>
            <p className="mt-2 text-sm text-slate-400">
              Create your first alert rule to turn spikes, drift, and anomalies into actionable incidents.
            </p>
          </div>
        ) : null}
      </section>

      <RuleBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onCreated={(rule) => {
          upsertAlertRule(rule);
          setToast(`${rule.name} created.`);
        }}
      />
    </div>
  );
}
