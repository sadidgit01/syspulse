"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        setErrorMessage("Invalid credentials");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Invalid credentials");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Operator login"
      title="Access the fleet surface"
      description="Sign in with your SysPulse operator account to resume monitoring and incident review."
      footer={
        <span>
          Need a workspace?{" "}
          <Link className="text-blue-300 transition hover:text-blue-200" href="/register">
            Create one
          </Link>
        </span>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
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
            autoComplete="current-password"
            name="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        {errorMessage ? (
          <p className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </p>
        ) : null}

        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in..." : "Sign in"}
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
