import * as React from "react";

import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        variant === "default"
          ? "border-transparent bg-blue-500/10 text-blue-100"
          : "border-white/10 bg-white/[0.03] text-slate-300",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
