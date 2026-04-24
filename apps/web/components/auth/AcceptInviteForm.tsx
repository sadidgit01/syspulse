"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isTokenMissing = useMemo(() => token.length === 0, [token]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTokenMissing) {
      setErrorMessage("Invite token is missing or invalid.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password, token })
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        setErrorMessage(body.detail ?? "Unable to accept invite");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Unable to accept invite");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Team invite"
      title="Join the workspace"
      description="Set your password to activate the invitation and open the dashboard."
      footer={
        <span>
          Already have access?{" "}
          <Link className="text-blue-300 transition hover:text-blue-200" href="/login">
            Sign in
          </Link>
        </span>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <Field label="Password">
          <Input
            autoComplete="new-password"
            name="password"
            type="password"
            placeholder="Create your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <PasswordStrength password={password} />

        {isTokenMissing ? (
          <p className="rounded-2xl border border-yellow-500/20 bg-yellow-500/8 px-4 py-3 text-sm text-yellow-100">
            This invite link is incomplete. Make sure the token is present in the URL.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}

        <Button className="w-full" type="submit" disabled={isSubmitting || isTokenMissing}>
          {isSubmitting ? "Accepting invite..." : "Accept invite"}
        </Button>
      </form>
    </AuthShell>
  );
}

function Field({
  label,
  children
}: Readonly<{
  label: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="block space-y-2">
      <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}
