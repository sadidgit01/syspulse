import fs from "node:fs/promises";
import path from "node:path";

export interface RegisterAgentResponse {
  agent_id: string;
  agent_token: string;
}

export interface HealthResponse {
  status: string;
  db: string;
  redis: string;
}

export interface AgentStatusResponse {
  id: string;
  org_id: string;
  hostname: string;
  os: string;
  arch: string;
  last_seen: string;
  status: "alive" | "offline";
}

export interface AgentCertBundleResponse {
  agent_cert_pem: string;
  agent_key_pem: string;
  ca_cert_pem: string;
  expires_at: string;
  fingerprint: string;
}

export async function checkHealth(server: string): Promise<HealthResponse> {
  const response = await fetch(`${normalizeServer(server)}/health`, {
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(`Health check failed with status ${response.status}.`);
  }
  return (await response.json()) as HealthResponse;
}

export async function getAgentCert(
  server: string,
  agentId: string,
  agentToken: string
): Promise<AgentCertBundleResponse> {
  const response = await fetch(`${normalizeServer(server)}/agents/${agentId}/cert`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${agentToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Unable to download mTLS certificates."));
  }

  return (await response.json()) as AgentCertBundleResponse;
}

export async function rotateAgentCert(
  server: string,
  agentId: string,
  agentToken: string
): Promise<AgentCertBundleResponse> {
  const response = await fetch(`${normalizeServer(server)}/agents/${agentId}/rotate-cert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Unable to rotate mTLS certificates."));
  }

  return (await response.json()) as AgentCertBundleResponse;
}

export async function registerAgent(
  server: string,
  payload: {
    hostname: string;
    os: string;
    arch: string;
    org_token: string;
  }
): Promise<RegisterAgentResponse> {
  const response = await fetch(`${normalizeServer(server)}/agents/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Agent registration failed."));
  }

  return (await response.json()) as RegisterAgentResponse;
}

export async function listAgents(
  server: string,
  accessToken: string
): Promise<AgentStatusResponse[]> {
  const response = await fetch(`${normalizeServer(server)}/agents`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, "Unable to list agents."));
  }

  return (await response.json()) as AgentStatusResponse[];
}

export async function saveCertificateBundle(
  certDir: string,
  bundle: AgentCertBundleResponse
): Promise<void> {
  await fs.mkdir(certDir, { recursive: true });
  await fs.writeFile(path.join(certDir, "cert.pem"), bundle.agent_cert_pem, { mode: 0o644 });
  await fs.writeFile(path.join(certDir, "key.pem"), bundle.agent_key_pem, { mode: 0o600 });
  await fs.writeFile(path.join(certDir, "ca.pem"), bundle.ca_cert_pem, { mode: 0o644 });
}

export function normalizeServer(server: string): string {
  return server.replace(/\/$/, "");
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    return fallback;
  }

  return fallback;
}
