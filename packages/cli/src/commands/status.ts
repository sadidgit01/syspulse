import { X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getAgentCertDir, loadConfig } from "../config";
import { listAgents } from "../lib/api";
import { logger } from "../lib/logger";
import { detectPlatform } from "../lib/platform";

export async function runStatus(accessTokenOverride?: string): Promise<void> {
  const config = await loadConfig();
  const accessToken = accessTokenOverride ?? config.userAccessToken;

  if (!accessToken) {
    throw new Error(
      "Status requires a dashboard access token. Re-run install with --access-token or provide --access-token now."
    );
  }

  const platform = detectPlatform();
  logger.step(`Checking remote status for ${platform.hostname}`);
  const agents = await listAgents(config.server, accessToken);
  const agent = agents.find((entry) => entry.id === config.agentId || entry.hostname === platform.hostname);

  if (!agent) {
    throw new Error("This machine is not registered in the remote organization.");
  }

  const lastSeen = new Date(agent.last_seen).toLocaleString();
  if (agent.status === "alive") {
    logger.success(`Agent ${agent.id} is alive`);
  } else {
    logger.warn(`Agent ${agent.id} is offline`);
  }

  const certStatus = await getCertificateStatus(getAgentCertDir());
  logger.info(`Server: ${config.server}`);
  logger.info(`Hostname: ${agent.hostname}`);
  logger.info(`Last seen: ${lastSeen}`);
  logger.info(certStatus.message);
}

export async function getCertificateStatus(certDir: string): Promise<{
  active: boolean;
  expiresAt?: Date;
  message: string;
}> {
  try {
    await fs.access(path.join(certDir, "key.pem"));
    await fs.access(path.join(certDir, "ca.pem"));
    const certPem = await fs.readFile(path.join(certDir, "cert.pem"), "utf-8");
    const certificate = new X509Certificate(certPem);
    const expiresAt = new Date(certificate.validTo);
    const daysRemaining = Math.max(
      0,
      Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    );
    const active = expiresAt.getTime() > Date.now();
    return {
      active,
      expiresAt,
      message: active
        ? `🔐 mTLS: active | cert expires in ${daysRemaining} days (${expiresAt.toLocaleDateString()})`
        : `🔐 mTLS: fallback HTTPS | cert expired on ${expiresAt.toLocaleDateString()}`
    };
  } catch {
    return {
      active: false,
      message: "🔐 mTLS: fallback HTTPS | no local certificate bundle found"
    };
  }
}
