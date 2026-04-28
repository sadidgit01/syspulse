import { Mail, Trash2, Webhook } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn, getChannelLabel, titleCase } from "@/lib/utils";
import type { AlertChannel } from "@/types";

export function ChannelChip({
  channel,
  onRemove
}: {
  channel: AlertChannel;
  onRemove?: () => void;
}) {
  const Icon = channel.type === "email" ? Mail : Webhook;

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
      <span
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border",
          channel.type === "email"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
            : "border-blue-500/20 bg-blue-500/10 text-blue-100"
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{titleCase(channel.type)}</p>
        <p className="max-w-72 truncate text-slate-200">{getChannelLabel(channel)}</p>
      </div>
      {onRemove ? (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
