import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { getAgentEnvPath } from "../config";
import type { PlatformInfo } from "./platform";

export interface ServiceInstallOptions {
  platform: PlatformInfo;
  agentBinaryPath: string;
  certDir: string;
  server: string;
  agentToken: string;
  interval: number;
}

interface NodeWindowsService {
  on(
    event: "install" | "alreadyinstalled" | "start" | "error",
    listener: (value?: unknown) => void
  ): void;
  install(): void;
}

interface NodeWindowsModule {
  Service: new (options: {
    name: string;
    description: string;
    script: string;
    workingDirectory: string;
    env: Array<{ name: string; value: string }>;
  }) => NodeWindowsService;
}

export async function installService(options: ServiceInstallOptions): Promise<void> {
  await writeAgentEnvFile(options);

  if (options.platform.os === "linux") {
    await installSystemdService(options);
    return;
  }

  if (options.platform.os === "darwin") {
    await installLaunchdService(options);
    return;
  }

  await installWindowsService(options);
}

export async function restartService(platform: PlatformInfo): Promise<void> {
  if (platform.os === "linux") {
    await runCommand("systemctl", ["restart", "syspulse-agent.service"]);
    return;
  }

  if (platform.os === "darwin") {
    const plistPath = "/Library/LaunchDaemons/com.syspulse.agent.plist";
    await runCommand("launchctl", ["unload", plistPath], { allowFailure: true });
    await runCommand("launchctl", ["load", "-w", plistPath]);
    return;
  }

  await runCommand("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Restart-Service -Name 'SysPulse Agent'"
  ]);
}

async function installSystemdService(options: ServiceInstallOptions): Promise<void> {
  const unitPath = "/etc/systemd/system/syspulse-agent.service";
  const envFilePath = getAgentEnvPath();
  const unitContents = `[Unit]
Description=SysPulse Go Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${quoteForSystemd(path.dirname(options.agentBinaryPath))}
EnvironmentFile=${quoteForSystemd(envFilePath)}
Environment=SYSPULSE_CERT_DIR=/root/.syspulse/certs
ExecStart=${quoteForSystemd(options.agentBinaryPath)}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

  await fs.writeFile(unitPath, unitContents, "utf-8");
  await runCommand("systemctl", ["daemon-reload"]);
  await runCommand("systemctl", ["enable", "syspulse-agent.service"]);
  await runCommand("systemctl", ["restart", "syspulse-agent.service"]);
}

async function installLaunchdService(options: ServiceInstallOptions): Promise<void> {
  const plistPath = "/Library/LaunchDaemons/com.syspulse.agent.plist";
  const plistContents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.syspulse.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.agentBinaryPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(path.dirname(options.agentBinaryPath))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SYSPULSE_SERVER</key>
    <string>${escapeXml(options.server)}</string>
    <key>AGENT_TOKEN</key>
    <string>${escapeXml(options.agentToken)}</string>
    <key>INTERVAL</key>
    <string>${escapeXml(String(options.interval))}</string>
    <key>SYSPULSE_CERT_DIR</key>
    <string>${escapeXml(options.certDir)}</string>
  </dict>
</dict>
</plist>
`;

  await fs.writeFile(plistPath, plistContents, "utf-8");
  await runCommand("launchctl", ["unload", plistPath], { allowFailure: true });
  await runCommand("launchctl", ["load", "-w", plistPath]);
}

async function installWindowsService(options: ServiceInstallOptions): Promise<void> {
  const wrapperPath = path.join(path.dirname(options.agentBinaryPath), "service-wrapper.js");
  const wrapperContents = `const { spawn } = require("node:child_process");
const child = spawn(${JSON.stringify(options.agentBinaryPath)}, [], {
  cwd: ${JSON.stringify(path.dirname(options.agentBinaryPath))},
  stdio: "inherit",
  env: {
    ...process.env,
    SYSPULSE_SERVER: ${JSON.stringify(options.server)},
    AGENT_TOKEN: ${JSON.stringify(options.agentToken)},
    INTERVAL: ${JSON.stringify(String(options.interval))},
    SYSPULSE_CERT_DIR: ${JSON.stringify(options.certDir)}
  }
});
child.on("exit", (code) => process.exit(code ?? 0));
`;
  await fs.writeFile(wrapperPath, wrapperContents, "utf-8");

  const module = (await import("node-windows")) as unknown as NodeWindowsModule;
  const service = new module.Service({
    name: "SysPulse Agent",
    description: "SysPulse Go metrics agent",
    script: wrapperPath,
    workingDirectory: path.dirname(options.agentBinaryPath),
    env: [
      { name: "SYSPULSE_SERVER", value: options.server },
      { name: "AGENT_TOKEN", value: options.agentToken },
      { name: "INTERVAL", value: String(options.interval) },
      { name: "SYSPULSE_CERT_DIR", value: options.certDir }
    ]
  });

  await new Promise<void>((resolve, reject) => {
    service.on("install", () => resolve());
    service.on("alreadyinstalled", () => resolve());
    service.on("error", (error) =>
      reject(error instanceof Error ? error : new Error("Windows service installation failed."))
    );
    service.install();
  });
}

async function writeAgentEnvFile(options: ServiceInstallOptions): Promise<void> {
  const envFile = `SYSPULSE_SERVER=${options.server}
AGENT_TOKEN=${options.agentToken}
INTERVAL=${options.interval}
SYSPULSE_CERT_DIR=${options.certDir}
`;
  await fs.writeFile(getAgentEnvPath(), envFile, "utf-8");
}

function quoteForSystemd(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    allowFailure?: boolean;
  } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.`));
    });
  });
}
