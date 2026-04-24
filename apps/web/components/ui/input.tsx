import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-12 w-full rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-blue-400/40 focus:bg-blue-500/[0.04]",
      className
    )}
    {...props}
  />
));

Input.displayName = "Input";

export { Input };
