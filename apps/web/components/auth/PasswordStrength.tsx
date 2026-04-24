import { cn } from "@/lib/utils";

export function getPasswordStrength(password: string): "weak" | "medium" | "strong" {
  const longEnough = password.length >= 10;
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const hasNumber = /\d/.test(password);

  if (password.length >= 12 && hasSpecial && hasNumber) {
    return "strong";
  }
  if (password.length >= 8 && (hasSpecial || hasNumber || longEnough)) {
    return "medium";
  }
  return "weak";
}

export function PasswordStrength({ password }: { password: string }) {
  const strength = getPasswordStrength(password);
  const bars = strength === "strong" ? 3 : strength === "medium" ? 2 : password ? 1 : 0;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={cn(
              "h-2 flex-1 rounded-full bg-white/[0.06] transition-colors",
              index < bars && strength === "weak" && "bg-red-400",
              index < bars && strength === "medium" && "bg-yellow-400",
              index < bars && strength === "strong" && "bg-emerald-400"
            )}
          />
        ))}
      </div>
      <p
        className={cn(
          "text-xs uppercase tracking-[0.18em]",
          strength === "weak" && "text-red-200",
          strength === "medium" && "text-yellow-100",
          strength === "strong" && "text-emerald-200",
          !password && "text-slate-500"
        )}
      >
        Password strength: {password ? strength : "not set"}
      </p>
    </div>
  );
}
