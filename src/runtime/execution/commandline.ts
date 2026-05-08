import type { DiscoveredService } from "../../contracts/service.js";
import { resolveServiceText, type ServiceTextResolutionOptions } from "../operator/variables.js";
import type { ProviderExecutionPlan } from "../providers/types.js";

export function selectPlatformCommandline(
  commandline: Record<string, string> | undefined,
  platform = process.platform,
): string | undefined {
  if (!commandline) {
    return undefined;
  }

  return commandline[platform] ?? commandline.default;
}

export function parseCommandlineArgs(commandline: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < commandline.trim().length; index += 1) {
    const char = commandline.trim()[index] ?? "";
    const nextChar = commandline.trim()[index + 1];

    if (char === "\\" && quote === "\"" && (nextChar === "\"" || nextChar === "\\")) {
      current += nextChar;
      index += 1;
      continue;
    }

    if ((char === "\"" || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Invalid service commandline: unclosed ${quote} quote.`);
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function resolveExecutionArgs(
  service: DiscoveredService,
  executionPlan: ProviderExecutionPlan,
  sharedGlobalEnv: Record<string, string> = {},
  resolvedPorts: Record<string, number> = {},
  options: ServiceTextResolutionOptions = {},
): string[] {
  const commandline = selectPlatformCommandline(service.manifest.commandline);
  if (!commandline) {
    return executionPlan.args.map((arg) => resolveServiceText(arg, service, sharedGlobalEnv, resolvedPorts, options));
  }

  return parseCommandlineArgs(resolveServiceText(commandline, service, sharedGlobalEnv, resolvedPorts, options));
}
