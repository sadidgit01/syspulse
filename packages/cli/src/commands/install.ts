import { getAgentEnvPath, getAgentInstallDir, saveConfig } from "../config";
import {
  checkHealth,
  downloadAgentBundle,
  listAgents,
  registerAgent
} from "../lib/api";
import { logger } from "../lib/logger";
import { detectPlatform } from "../lib/platform";
import {
  detectPythonRuntime,
  installPythonDependencies,
  installService
} from "../lib/service";

export interface InstallOptions {
  server: string;
  token: string;
  accessToken?: string;
  dev?: boolean;
  interval?: number;
}

export async function runInstall(options: InstallOptions): Promise<void> {
  if (!options.server || !options.token) {
    throw new Error("Usage: syspulse-agent install --server <url> --token <org_token>");
  }

  if (options.interval !== undefined && (!Number.isFinite(options.interval) || options.interval <= 0)) {
    throw new Error("--interval must be a positive number of seconds.");
  }

  logger.banner();

  const platform = detectPlatform();
  const interval = options.interval ?? 5;
  logger.step(`Detected ${platform.os} (${platform.arch}) on ${platform.hostname}`);

  logger.step("Checking SysPulse server health");
  await checkHealth(options.server);
  logger.success("Server is reachable");

  logger.step("Registering this machine with SysPulse");
  const registration = await registerAgent(options.server, {
    hostname: platform.hostname,
    os: platform.os,
    arch: platform.arch,
    org_token: options.token
  });
  logger.success(`Agent registered as ${registration.agent_id}`);

  logger.step("Saving local agent configuration");
  await saveConfig({
    server: options.server,
    agentId: registration.agent_id,
    agentToken: registration.agent_token,
    userAccessToken: options.accessToken,
    installedAt: new Date().toISOString()
  });

  const agentDir = getAgentInstallDir();
  logger.step(options.dev ? "Copying local Python agent bundle" : "Downloading Python agent bundle");
  await downloadAgentBundle({
    server: options.server,
    destinationDir: agentDir,
    devMode: options.dev ?? false
  });
  logger.success(`Python agent ready at ${agentDir}`);

  logger.step("Detecting Python runtime");
  const pythonRuntime = await detectPythonRuntime();
  logger.success(`Using ${pythonRuntime.displayName}`);

  logger.step("Installing Python agent dependencies");
  await installPythonDependencies(agentDir, pythonRuntime);
  logger.success("Python dependencies installed");

  logger.step("Installing background service");
  await installService({
    platform,
    agentDir,
    pythonRuntime,
    server: options.server,
    agentToken: registration.agent_token,
    interval
  });
  logger.success("Background service installed");

  logger.step("Waiting for the agent service to start");
  await wait(5_000);

  if (options.accessToken) {
    logger.step("Verifying agent presence in SysPulse");
    const agents = await listAgents(options.server, options.accessToken);
    const agent = agents.find((entry) => entry.id === registration.agent_id);
    if (!agent) {
      throw new Error("Agent did not appear in the SysPulse dashboard after installation.");
    }
    logger.success(`Agent is ${agent.status}`);
  } else {
    logger.warn(
      "Skipped remote agent verification because no dashboard access token was provided. Pass --access-token to verify via /agents."
    );
  }

  logger.success("SysPulse agent installed and running");
  logger.info(`Reporting to: ${options.server}`);
  logger.info(`Agent ID: ${registration.agent_id}`);
  logger.info(`View in dashboard: ${options.server.replace(/\/$/, "")}/dashboard`);
  logger.info(`Agent env file: ${getAgentEnvPath()}`);
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
