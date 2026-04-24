import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface CliConfig {
  server: string;
  agentId: string;
  agentToken: string;
  userAccessToken?: string;
  installedAt: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".syspulse");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const AGENT_DIR = path.join(CONFIG_DIR, "python_agent");
const AGENT_ENV_PATH = path.join(CONFIG_DIR, "agent.env");

export async function ensureCliHome(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

export async function saveConfig(config: CliConfig): Promise<void> {
  await ensureCliHome();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function loadConfig(): Promise<CliConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as CliConfig;
}

export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getAgentInstallDir(): string {
  return AGENT_DIR;
}

export function getAgentEnvPath(): string {
  return AGENT_ENV_PATH;
}
