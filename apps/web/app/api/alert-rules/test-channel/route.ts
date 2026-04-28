import { NextRequest, NextResponse } from "next/server";

import type { AlertChannel } from "@/types";

function isAlertChannel(value: unknown): value is AlertChannel {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "email") {
    return typeof record.address === "string" && record.address.length > 3;
  }
  if (record.type === "slack" || record.type === "discord") {
    return typeof record.webhook_url === "string" && record.webhook_url.startsWith("http");
  }
  if (record.type === "webhook") {
    return (
      typeof record.url === "string" &&
      record.url.startsWith("http") &&
      (record.method === "POST" || record.method === "PUT" || record.method === "PATCH")
    );
  }
  return false;
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as unknown;
  if (!isAlertChannel(payload)) {
    return NextResponse.json({ detail: "Invalid channel payload." }, { status: 400 });
  }

  if (payload.type === "email") {
    return NextResponse.json({ detail: `Email check passed for ${payload.address}.` });
  }

  if (payload.type === "webhook") {
    const response = await fetch(payload.url, {
      method: payload.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "SysPulse test alert",
        source: "syspulse-web",
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      return NextResponse.json({ detail: `Webhook test failed with ${response.status}.` }, { status: 502 });
    }

    return NextResponse.json({ detail: "Webhook test delivered." });
  }

  const response = await fetch(payload.webhook_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text: "SysPulse test alert",
      username: "SysPulse"
    })
  });

  if (!response.ok) {
    return NextResponse.json(
      { detail: `Channel test failed with ${response.status}.` },
      { status: 502 }
    );
  }

  return NextResponse.json({ detail: `${payload.type} test delivered.` });
}
