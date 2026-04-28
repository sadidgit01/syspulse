import { buildAlertConditionSummary, titleCase } from "@/lib/utils";
import type { AlertCondition, AlertRuleConditionType } from "@/types";

export function ConditionPreview({
  conditionType,
  condition
}: {
  conditionType: AlertRuleConditionType;
  condition: AlertCondition;
}) {
  return (
    <div className="rounded-3xl border border-blue-500/20 bg-blue-500/8 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-blue-200">Live Preview</p>
      <p className="mt-3 text-sm leading-7 text-blue-50">
        {buildAlertConditionSummary(conditionType, condition)}
      </p>
      <p className="mt-2 text-xs text-blue-100/75">Condition type: {titleCase(conditionType)}</p>
    </div>
  );
}
