import fs from "node:fs/promises";

import {
  getAgentBinDir,
  getAgentBinaryPath,
  getAgentCertDir,
  getAgentEnvPath,
  saveConfig
} from "../config";
import {
  checkHealth,
  getAgentCert,
  listAgents,
  registerAgent,
  saveCertificateBundle
} from "../lib/api";
import { logger } from "../lib/logger";
import { detectPlatform, type PlatformInfo } from "../lib/platform";
import { installService } from "../lib/service";

export interface InstallOptions {
  server: string;
  token: string;
  accessToken?: string;
  dev?: boolean;
  interval?: number;
}

const releaseBaseUrl = "https://github.com/sadidgit01/syspulse/releases/latest/download";

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
  const binaryName = getReleaseBinaryName(platform);
  const agentBinaryPath = getAgentBinaryPath(platform.os === "windows");
  const certDir = getAgentCertDir();
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

  logger.step(`Downloading Go agent binary (${binaryName})`);
  await downloadReleaseBinary(binaryName, agentBinaryPath, platform.os === "windows");
  logger.success(`Go agent installed at ${agentBinaryPath}`);

  logger.step("Installing mTLS certificates");
  const certBundle = await getAgentCert(
    options.server,
    registration.agent_id,
    registration.agent_token
  );
  await saveCertificateBundle(certDir, certBundle);
  logger.success("🔐 mTLS certificates installed");

  logger.step("Saving local agent configuration");
  await saveConfig({
    server: options.server,
    agentId: registration.agent_id,
    agentToken: registration.agent_token,
    userAccessToken: options.accessToken,
    installedAt: new Date().toISOString()
  });

  logger.step("Installing background service");
  await installService({
    platform,
    agentBinaryPath,
    certDir,
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
  logger.info(`Cert directory: ${certDir}`);
}

export function getReleaseBinaryName(platform: PlatformInfo): string {
  if (platform.os === "linux" && platform.arch === "amd64") {
    return "syspulse-agent-linux-amd64";
  }
  if (platform.os === "linux" && platform.arch === "arm64") {
    return "syspulse-agent-linux-arm64";
  }
  if (platform.os === "windows" && platform.arch === "amd64") {
    return "syspulse-agent-windows-amd64.exe";
  }
  if (platform.os === "darwin" && platform.arch === "amd64") {
    return "syspulse-agent-darwin-amd64";
  }
  if (platform.os === "darwin" && platform.arch === "arm64") {
    return "syspulse-agent-darwin-arm64";
  }
  throw new Error(`Unsupported platform: ${platform.os}/${platform.arch}`);
}

async function downloadReleaseBinary(
  binaryName: string,
  destinationPath: string,
  isWindows: boolean
): Promise<void> {
  await fs.mkdir(getAgentBinDir(), { recursive: true });
  const response = await fetch(`${releaseBaseUrl}/${binaryName}`);
  if (!response.ok || response.body === null) {
    throw new Error(`Unable to download ${binaryName} from GitHub Releases.`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? "0");
  const tempPath = `${destinationPath}.download`;
  const fileHandle = await fs.open(tempPath, "w");
  let downloadedBytes = 0;

  try {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      await fileHandle.write(chunk);
      downloadedBytes += chunk.byteLength;
      renderProgress(downloadedBytes, totalBytes);
    }
  } finally {
    await fileHandle.close();
  }

  process.stdout.write("\n");
  await fs.rm(destinationPath, { force: true });
  await fs.rename(tempPath, destinationPath);
  if (!isWindows) {
    await fs.chmod(destinationPath, 0o755);
  }
}

function renderProgress(downloadedBytes: number, totalBytes: number): void {
  if (totalBytes <= 0) {
    process.stdout.write(`\rDownloaded ${formatBytes(downloadedBytes)}`);
    return;
  }

  const width = 24;
  const ratio = Math.min(downloadedBytes / totalBytes, 1);
  const filled = Math.round(ratio * width);
  const bar = "#".repeat(filled) + "-".repeat(width - filled);
  process.stdout.write(
    `\r[${bar}] ${Math.round(ratio * 100)}% (${formatBytes(downloadedBytes)}/${formatBytes(totalBytes)})`
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
