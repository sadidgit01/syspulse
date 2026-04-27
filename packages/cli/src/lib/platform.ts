import os from "node:os";

export type SupportedPlatform = "linux" | "windows" | "darwin";
export type SupportedArch = "amd64" | "arm64";

export interface PlatformInfo {
  os: SupportedPlatform;
  arch: SupportedArch;
  hostname: string;
  homeDir: string;
}

export function detectPlatform(): PlatformInfo {
  return {
    os: mapPlatform(process.platform),
    arch: mapArch(process.arch),
    hostname: os.hostname(),
    homeDir: os.homedir()
  };
}

function mapPlatform(platform: NodeJS.Platform): SupportedPlatform {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

function mapArch(arch: string): SupportedArch {
  switch (arch) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported CPU architecture: ${arch}`);
  }
}
