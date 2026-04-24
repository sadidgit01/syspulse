#!/usr/bin/env node

import minimist from "minimist";

import { runInstall } from "./commands/install";
import { runStatus } from "./commands/status";
import { logger } from "./lib/logger";

interface ParsedArgs extends minimist.ParsedArgs {
  server?: string;
  token?: string;
  "access-token"?: string;
  dev?: boolean;
  interval?: string | number;
}

async function main() {
  const argv = minimist<ParsedArgs>(process.argv.slice(2), {
    boolean: ["dev"],
    string: ["server", "token", "access-token", "interval"],
    alias: {
      s: "server",
      t: "token"
    }
  });

  const command = argv._[0];

  try {
    switch (command) {
      case "install":
        await runInstall({
          server: argv.server ?? "",
          token: argv.token ?? "",
          accessToken: argv["access-token"],
          dev: argv.dev,
          interval: argv.interval ? Number(argv.interval) : undefined
        });
        break;
      case "status":
        await runStatus(argv["access-token"]);
        break;
      default:
        printHelp();
        process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected CLI error.";
    logger.error(message);
    process.exitCode = 1;
  }
}

function printHelp() {
  logger.banner();
  logger.info("Usage:");
  logger.info("  syspulse-agent install --server <url> --token <org_token> [--access-token <user_access_token>] [--dev]");
  logger.info("  syspulse-agent status [--access-token <user_access_token>]");
}

void main();
