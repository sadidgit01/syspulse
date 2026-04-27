import { getAgentCertDir, loadConfig } from "../config";
import { rotateAgentCert, saveCertificateBundle } from "../lib/api";
import { logger } from "../lib/logger";
import { detectPlatform } from "../lib/platform";
import { restartService } from "../lib/service";

export async function runRotateCert(): Promise<void> {
  const config = await loadConfig();
  const platform = detectPlatform();
  const certDir = getAgentCertDir();

  logger.step("Requesting rotated mTLS certificate");
  const bundle = await rotateAgentCert(config.server, config.agentId, config.agentToken);
  await saveCertificateBundle(certDir, bundle);
  logger.success("mTLS certificates rotated");

  logger.step("Restarting SysPulse agent service");
  await restartService(platform);
  logger.success("SysPulse agent service restarted");
  logger.info(`New cert expires: ${new Date(bundle.expires_at).toLocaleString()}`);
}
