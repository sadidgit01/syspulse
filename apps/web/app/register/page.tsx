"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const payload = useMemo(
    () => ({
      email,
      password,
      org_name: orgName
    }),
    [email, password, orgName]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        setErrorMessage(body.detail ?? "Unable to create account");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Unable to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Workspace setup"
      title="Create your observability workspace"
      description="Provision a new organization and admin operator in one move, then drop directly into the dashboard."
      footer={
        <span>
          Already onboarded?{" "}
          <Link className="text-blue-300 transition hover:text-blue-200" href="/login">
            Sign in
          </Link>
        </span>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <Field label="Organization name">
          <Input
            name="orgName"
            placeholder="Acme Infrastructure"
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            required
          />
        </Field>

        <Field label="Email">
          <Input
            autoComplete="email"
            name="email"
            type="email"
            placeholder="operator@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Password">
          <Input
            autoComplete="new-password"
            name="password"
            type="password"
            placeholder="Choose a strong password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <PasswordStrength password={password} />

        {errorMessage ? (
          <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}

        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating workspace..." : "Create workspace"}
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
