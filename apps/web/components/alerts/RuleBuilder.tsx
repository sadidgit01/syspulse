"use client";

import { CheckCircle2, ChevronRight, Plus, SendHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

import { ChannelChip } from "@/components/alerts/ChannelChip";
import { ConditionPreview } from "@/components/alerts/ConditionPreview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAlertRule, testAlertChannel } from "@/lib/api";
import { cn, titleCase } from "@/lib/utils";
import type {
  AlertAnomalyScoreCondition,
  AlertChannel,
  AlertCompositeCondition,
  AlertCompositeSubCondition,
  AlertCondition,
  AlertRule,
  AlertRuleConditionType,
  AlertThresholdCondition,
  ForecastMetric,
  IncidentSeverity
} from "@/types";

const STEP_LABELS = ["Basic Info", "Condition", "Channels"] as const;
const METRIC_OPTIONS: Array<{ label: string; value: ForecastMetric }> = [
  { label: "CPU", value: "cpu_percent" },
  { label: "Memory", value: "memory_percent" },
  { label: "Disk", value: "disk_percent" }
];

export function RuleBuilder({
  open,
  onClose,
  onCreated
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (rule: AlertRule) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("high");
  const [cooldownMinutes, setCooldownMinutes] = useState(30);
  const [conditionType, setConditionType] = useState<AlertRuleConditionType>("threshold");
  const [thresholdCondition, setThresholdCondition] = useState<AlertThresholdCondition>({
    metric: "cpu_percent",
    operator: ">",
    value: 85,
    duration_minutes: 5
  });
  const [relativeCondition, setRelativeCondition] = useState({
    metric: "cpu_percent" as ForecastMetric,
    operator: ">" as ">" | "<",
    percent_change: 50,
    baseline_hours: 24
  });
  const [compositeCondition, setCompositeCondition] = useState<AlertCompositeCondition>({
    operator: "AND",
    conditions: [
      { metric: "cpu_percent", operator: ">", value: 80 },
      { metric: "memory_percent", operator: ">", value: 75 }
    ]
  });
  const [anomalyCondition, setAnomalyCondition] = useState<AlertAnomalyScoreCondition>({
    min_score: 0.6,
    reasons: ["cpu_spike", "memory_spike", "multi_metric"]
  });
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [channelType, setChannelType] = useState<AlertChannel["type"]>("slack");
  const [channelValue, setChannelValue] = useState("");
  const [channelMethod, setChannelMethod] = useState<"POST" | "PUT" | "PATCH">("POST");
  const [channelStatus, setChannelStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingChannel, setIsTestingChannel] = useState(false);

  const condition = useMemo<AlertCondition>(() => {
    if (conditionType === "threshold") {
      return thresholdCondition;
    }
    if (conditionType === "relative") {
      return relativeCondition;
    }
    if (conditionType === "composite") {
      return compositeCondition;
    }
    return anomalyCondition;
  }, [anomalyCondition, compositeCondition, conditionType, relativeCondition, thresholdCondition]);

  if (!open) {
    return null;
  }

  const resetState = () => {
    setStep(1);
    setName("");
    setDescription("");
    setSeverity("high");
    setCooldownMinutes(30);
    setConditionType("threshold");
    setThresholdCondition({
      metric: "cpu_percent",
      operator: ">",
      value: 85,
      duration_minutes: 5
    });
    setRelativeCondition({
      metric: "cpu_percent",
      operator: ">",
      percent_change: 50,
      baseline_hours: 24
    });
    setCompositeCondition({
      operator: "AND",
      conditions: [
        { metric: "cpu_percent", operator: ">", value: 80 },
        { metric: "memory_percent", operator: ">", value: 75 }
      ]
    });
    setAnomalyCondition({
      min_score: 0.6,
      reasons: ["cpu_spike", "memory_spike", "multi_metric"]
    });
    setChannels([]);
    setChannelType("slack");
    setChannelValue("");
    setChannelMethod("POST");
    setChannelStatus(null);
    setError(null);
    setSuccess(null);
    setIsSubmitting(false);
    setIsTestingChannel(false);
  };

  const close = () => {
    resetState();
    onClose();
  };

  const handleAddChannel = () => {
    if (!channelValue.trim()) {
      setChannelStatus("Add a destination before saving the channel.");
      return;
    }

    let channel: AlertChannel;
    if (channelType === "email") {
      channel = { type: "email", address: channelValue.trim() };
    } else if (channelType === "webhook") {
      channel = {
        type: "webhook",
        url: channelValue.trim(),
        method: channelMethod
      };
    } else {
      channel = {
        type: channelType,
        webhook_url: channelValue.trim()
      };
    }

    setChannels((current) => [...current, channel]);
    setChannelValue("");
    setChannelStatus(`${titleCase(channelType)} channel added.`);
  };

  const handleTestChannel = async () => {
    if (!channelValue.trim()) {
      setChannelStatus("Add a destination before testing.");
      return;
    }

    try {
      setIsTestingChannel(true);
      const draftChannel: AlertChannel =
        channelType === "email"
          ? { type: "email", address: channelValue.trim() }
          : channelType === "webhook"
            ? { type: "webhook", url: channelValue.trim(), method: channelMethod }
            : { type: channelType, webhook_url: channelValue.trim() };
      const result = await testAlertChannel(draftChannel);
      setChannelStatus(result.detail);
    } catch (nextError) {
      setChannelStatus(nextError instanceof Error ? nextError.message : "Unable to test channel.");
    } finally {
      setIsTestingChannel(false);
    }
  };

  const handleCreateRule = async () => {
    if (!name.trim()) {
      setError("Rule name is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const rule = await createAlertRule({
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        isEnabled: true,
        conditionType,
        conditionJson: condition,
        severity,
        channelsJson: channels,
        cooldownMinutes
      });
      setSuccess("Rule created.");
      onCreated(rule);
      close();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create rule.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 p-4 backdrop-blur-sm" onClick={close}>
      <div
        className="panel-surface max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[32px] border border-slate-800/80 p-6 shadow-[0_40px_100px_rgba(0,0,0,0.52)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Alert Rule Builder</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Create a custom alert</h2>
          </div>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {STEP_LABELS.map((label, index) => {
            const currentStep = index + 1;
            const active = currentStep === step;
            const complete = currentStep < step;
            return (
              <div key={label} className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold",
                    active
                      ? "border-blue-500/30 bg-blue-500/12 text-blue-100"
                      : complete
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-white/[0.03] text-slate-400"
                  )}
                >
                  {complete ? <CheckCircle2 className="h-4 w-4" /> : currentStep}
                </div>
                <div>
                  <p className={cn("text-sm font-medium", active ? "text-white" : "text-slate-400")}>{label}</p>
                </div>
                {currentStep < STEP_LABELS.length ? <ChevronRight className="h-4 w-4 text-slate-600" /> : null}
              </div>
            );
          })}
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            {step === 1 ? (
              <section className="space-y-4">
                <Field label="Rule name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="CPU pressure lane" />
                </Field>
                <Field label="Description">
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    className="w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/40"
                    placeholder="Tell operators what this rule is protecting."
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Severity">
                    <select
                      value={severity}
                      onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}
                      className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
                    >
                      {(["low", "medium", "high", "critical"] as IncidentSeverity[]).map((item) => (
                        <option key={item} value={item} className="bg-slate-950">
                          {titleCase(item)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Cooldown (minutes)">
                    <Input
                      type="number"
                      min={0}
                      max={10080}
                      value={cooldownMinutes}
                      onChange={(event) => setCooldownMinutes(Number(event.target.value) || 0)}
                    />
                  </Field>
                </div>
              </section>
            ) : null}

            {step === 2 ? (
              <section className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {([
                    { key: "threshold", title: "THRESHOLD", body: "Metric crosses a fixed value" },
                    { key: "relative", title: "RELATIVE", body: "Metric changes versus baseline" },
                    { key: "composite", title: "COMPOSITE", body: "Multiple conditions together" },
                    { key: "anomaly_score", title: "ANOMALY_SCORE", body: "AI detects an anomaly" }
                  ] as const).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={cn(
                        "rounded-3xl border p-4 text-left transition-all",
                        conditionType === item.key
                          ? "border-blue-500/30 bg-blue-500/10 text-white shadow-[0_0_24px_rgba(59,130,246,0.14)]"
                          : "border-white/8 bg-white/[0.03] text-slate-300 hover:border-white/16"
                      )}
                      onClick={() => setConditionType(item.key)}
                    >
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="mt-2 text-sm text-slate-400">{item.body}</p>
                    </button>
                  ))}
                </div>

                {conditionType === "threshold" ? (
                  <ThresholdEditor condition={thresholdCondition} onChange={setThresholdCondition} />
                ) : null}
                {conditionType === "relative" ? (
                  <RelativeEditor
                    condition={relativeCondition}
                    onChange={(nextCondition) => setRelativeCondition(nextCondition)}
                  />
                ) : null}
                {conditionType === "composite" ? (
                  <CompositeEditor condition={compositeCondition} onChange={setCompositeCondition} />
                ) : null}
                {conditionType === "anomaly_score" ? (
                  <AnomalyEditor condition={anomalyCondition} onChange={setAnomalyCondition} />
                ) : null}
              </section>
            ) : null}

            {step === 3 ? (
              <section className="space-y-5">
                <div className="grid gap-4 md:grid-cols-[180px_1fr_140px]">
                  <Field label="Channel type">
                    <select
                      value={channelType}
                      onChange={(event) => setChannelType(event.target.value as AlertChannel["type"])}
                      className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
                    >
                      <option value="slack" className="bg-slate-950">Slack</option>
                      <option value="discord" className="bg-slate-950">Discord</option>
                      <option value="email" className="bg-slate-950">Email</option>
                      <option value="webhook" className="bg-slate-950">Webhook</option>
                    </select>
                  </Field>
                  <Field label={channelType === "email" ? "Email address" : "Destination"}>
                    <Input
                      value={channelValue}
                      onChange={(event) => setChannelValue(event.target.value)}
                      placeholder={
                        channelType === "email"
                          ? "ops@example.com"
                          : "https://hooks.slack.com/services/..."
                      }
                    />
                  </Field>
                  <Field label="Method">
                    {channelType === "webhook" ? (
                      <select
                        value={channelMethod}
                        onChange={(event) => setChannelMethod(event.target.value as "POST" | "PUT" | "PATCH")}
                        className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
                      >
                        {(["POST", "PUT", "PATCH"] as const).map((method) => (
                          <option key={method} value={method} className="bg-slate-950">
                            {method}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex h-12 items-center rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-slate-400">
                        POST
                      </div>
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" onClick={() => void handleTestChannel()} disabled={isTestingChannel}>
                    <SendHorizontal className="mr-2 h-4 w-4" />
                    {isTestingChannel ? "Testing..." : "Test channel"}
                  </Button>
                  <Button variant="outline" onClick={handleAddChannel}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add channel
                  </Button>
                </div>

                {channelStatus ? (
                  <p className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                    {channelStatus}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  {channels.map((channel, index) => (
                    <ChannelChip
                      key={`${channel.type}-${index}`}
                      channel={channel}
                      onRemove={() =>
                        setChannels((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Rule Summary</p>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-sm text-slate-500">Name</p>
                  <p className="text-base font-semibold text-white">{name || "Untitled rule"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-200">
                    {titleCase(severity)}
                  </Badge>
                  <Badge variant="outline" className="border-white/10 bg-white/[0.03] text-slate-200">
                    Cooldown {cooldownMinutes}m
                  </Badge>
                </div>
              </div>
            </div>

            <ConditionPreview conditionType={conditionType} condition={condition} />

            <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Channels</p>
              <div className="mt-4 space-y-3">
                {channels.length > 0 ? (
                  channels.map((channel, index) => (
                    <ChannelChip key={`${channel.type}-summary-${index}`} channel={channel} />
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No channels added yet.</p>
                )}
              </div>
            </div>

            {error ? (
              <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {success}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap justify-between gap-3">
          <div className="flex gap-3">
            <Button variant="ghost" disabled={step === 1} onClick={() => setStep((current) => current - 1)}>
              Back
            </Button>
            {step < 3 ? (
              <Button variant="outline" onClick={() => setStep((current) => current + 1)}>
                Next
              </Button>
            ) : null}
          </div>

          {step === 3 ? (
            <Button onClick={() => void handleCreateRule()} disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Rule"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function MetricSelect({
  value,
  onChange
}: {
  value: ForecastMetric;
  onChange: (metric: ForecastMetric) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as ForecastMetric)}
      className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
    >
      {METRIC_OPTIONS.map((item) => (
        <option key={item.value} value={item.value} className="bg-slate-950">
          {item.label}
        </option>
      ))}
    </select>
  );
}

function ThresholdEditor({
  condition,
  onChange
}: {
  condition: AlertThresholdCondition;
  onChange: (condition: AlertThresholdCondition) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Metric">
          <MetricSelect value={condition.metric} onChange={(metric) => onChange({ ...condition, metric })} />
        </Field>
        <Field label="Operator">
          <select
            value={condition.operator}
            onChange={(event) =>
              onChange({
                ...condition,
                operator: event.target.value as AlertThresholdCondition["operator"]
              })
            }
            className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
          >
            {([">", "<", ">=", "<="] as const).map((operator) => (
              <option key={operator} value={operator} className="bg-slate-950">
                {operator}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration (minutes)">
          <Input
            type="number"
            min={1}
            value={condition.duration_minutes}
            onChange={(event) =>
              onChange({ ...condition, duration_minutes: Number(event.target.value) || 1 })
            }
          />
        </Field>
      </div>
      <Field label={`Value: ${condition.value}%`}>
        <input
          type="range"
          min={0}
          max={100}
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })}
          className="w-full accent-blue-500"
        />
      </Field>
    </div>
  );
}

function RelativeEditor({
  condition,
  onChange
}: {
  condition: {
    metric: ForecastMetric;
    operator: ">" | "<";
    percent_change: number;
    baseline_hours: number;
  };
  onChange: (condition: {
    metric: ForecastMetric;
    operator: ">" | "<";
    percent_change: number;
    baseline_hours: number;
  }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Metric">
          <MetricSelect value={condition.metric} onChange={(metric) => onChange({ ...condition, metric })} />
        </Field>
        <Field label="Direction">
          <select
            value={condition.operator}
            onChange={(event) => onChange({ ...condition, operator: event.target.value as ">" | "<" })}
            className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
          >
            <option value=">" className="bg-slate-950">Rises by</option>
            <option value="<" className="bg-slate-950">Drops by</option>
          </select>
        </Field>
        <Field label="Baseline hours">
          <Input
            type="number"
            min={1}
            value={condition.baseline_hours}
            onChange={(event) => onChange({ ...condition, baseline_hours: Number(event.target.value) || 1 })}
          />
        </Field>
      </div>
      <Field label={`Percent change: ${condition.percent_change}%`}>
        <input
          type="range"
          min={10}
          max={200}
          value={condition.percent_change}
          onChange={(event) => onChange({ ...condition, percent_change: Number(event.target.value) })}
          className="w-full accent-blue-500"
        />
      </Field>
    </div>
  );
}

function CompositeEditor({
  condition,
  onChange
}: {
  condition: AlertCompositeCondition;
  onChange: (condition: AlertCompositeCondition) => void;
}) {
  const updateSubCondition = (index: number, nextCondition: AlertCompositeSubCondition) => {
    const nextConditions = condition.conditions.map((item, itemIndex) =>
      itemIndex === index ? nextCondition : item
    );
    onChange({ ...condition, conditions: nextConditions });
  };

  return (
    <div className="space-y-4">
      <Field label="Operator">
        <select
          value={condition.operator}
          onChange={(event) => onChange({ ...condition, operator: event.target.value as "AND" | "OR" })}
          className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
        >
          <option value="AND" className="bg-slate-950">AND</option>
          <option value="OR" className="bg-slate-950">OR</option>
        </select>
      </Field>
      <div className="space-y-4">
        {condition.conditions.map((subCondition, index) => (
          <div key={`${subCondition.metric}-${index}`} className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <MetricSelect value={subCondition.metric} onChange={(metric) => updateSubCondition(index, { ...subCondition, metric })} />
              <select
                value={subCondition.operator}
                onChange={(event) =>
                  updateSubCondition(index, {
                    ...subCondition,
                    operator: event.target.value as AlertCompositeSubCondition["operator"]
                  })
                }
                className="h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 text-sm text-white outline-none transition focus:border-blue-400/40"
              >
                {([">", "<", ">=", "<="] as const).map((operator) => (
                  <option key={operator} value={operator} className="bg-slate-950">
                    {operator}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                max={100}
                value={subCondition.value}
                onChange={(event) =>
                  updateSubCondition(index, { ...subCondition, value: Number(event.target.value) || 0 })
                }
              />
            </div>
          </div>
        ))}
      </div>
      {condition.conditions.length < 3 ? (
        <Button
          variant="outline"
          onClick={() =>
            onChange({
              ...condition,
              conditions: [
                ...condition.conditions,
                { metric: "disk_percent", operator: ">", value: 70 }
              ]
            })
          }
        >
          Add sub-condition
        </Button>
      ) : null}
    </div>
  );
}

function AnomalyEditor({
  condition,
  onChange
}: {
  condition: AlertAnomalyScoreCondition;
  onChange: (condition: AlertAnomalyScoreCondition) => void;
}) {
  const reasons = ["cpu_spike", "memory_spike", "network_spike", "multi_metric"] as const;
  return (
    <div className="space-y-4">
      <Field label={`Sensitivity: ${condition.min_score.toFixed(1)}`}>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={condition.min_score}
          onChange={(event) => onChange({ ...condition, min_score: Number(event.target.value) })}
          className="w-full accent-blue-500"
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        {reasons.map((reason) => {
          const checked = condition.reasons.includes(reason);
          return (
            <label
              key={reason}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange({
                    ...condition,
                    reasons: checked
                      ? condition.reasons.filter((item) => item !== reason)
                      : [...condition.reasons, reason]
                  })
                }
                className="h-4 w-4 rounded border-white/12 bg-white/5 accent-blue-500"
              />
              {titleCase(reason)}
            </label>
          );
        })}
      </div>
    </div>
  );
}
