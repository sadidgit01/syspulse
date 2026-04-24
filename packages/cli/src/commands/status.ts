import { loadConfig } from "../config";
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

  logger.info(`Server: ${config.server}`);
  logger.info(`Hostname: ${agent.hostname}`);
  logger.info(`Last seen: ${lastSeen}`);
}
