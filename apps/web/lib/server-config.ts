export function getRequiredServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured for SysPulse server routes.`);
  }
  return value.replace(/\/$/, "");
}

export function getBackendBaseUrl(): string {
  return getRequiredServerEnv("NEXT_PUBLIC_API_URL");
}
