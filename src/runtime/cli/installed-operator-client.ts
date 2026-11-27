import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { resolveRuntimeConfig, type RuntimeConfig } from "../config.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { discoverRuntimeLane } from "../instance/registry.js";
import { selectArtifactPlatform } from "../setup/artifact-platform.js";
import { parseLifecycleState } from "../state/rehydrate.js";
import { readStoredState } from "../state/readState.js";

export type InstalledOperatorClient = "cli" | "tui";

const providers = {
  cli: { id: "@cli", repository: "service-lasso/service-lasso-cli", originEnv: "SERVICE_LASSO_CORE_URL" },
  tui: { id: "@tui", repository: "service-lasso/service-lasso-tui", originEnv: "SERVICE_LASSO_API_URL" },
} as const;

function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function hasFlag(args: readonly string[], ...flags: string[]): boolean {
  return args.some(arg => flags.some(flag => arg === flag || arg.startsWith(flag + "=")));
}

function selectCheckoutTarget(client: InstalledOperatorClient, args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (hasFlag(args, "--help", "-help", "-h", "--version", "-V") || env[providers[client].originEnv]) return false;
  if (client === "tui") {
    return !hasFlag(args, "--api", "-api", "--connections", "-connections", "--profile", "-profile", "--connect", "-connect")
      && !env.SERVICE_LASSO_API_PROFILE && !env.SERVICE_LASSO_CONNECTIONS_CONFIG;
  }
  if (hasFlag(args, "--core-url", "--connection") || env.SERVICE_LASSO_CONNECTION) return false;
  const [group, action] = args.filter(arg => !arg.startsWith("-"));
  return group === "instance" || group === "operator"
    || (group === "service" && ["list", "register", "operation"].includes(action));
}

// The installed CLI owns the connection values and validation. Check only
// whether it has a saved selection, because the checkout environment would
// otherwise override that selection in its existing precedence order.
async function cliHasSavedTarget(): Promise<boolean> {
  try {
    const config = JSON.parse(await readFile(path.join(homedir(), ".service-lasso-cli", "config.json"), "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) return true;
    return Boolean(config.coreUrl || config.defaultConnection);
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT";
  }
}

async function checkoutOrigin(config: RuntimeConfig): Promise<string | null> {
  const lane = await discoverRuntimeLane(config);
  if (lane.classification !== "selected" || !lane.endpoint) return null;
  const url = URL.parse(lane.endpoint);
  if (!url || url.protocol !== "http:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) return null;
  const loopback = ["localhost", "[::1]"].includes(url.hostname)
    || (isIP(url.hostname) === 4 && url.hostname.startsWith("127."));
  return loopback ? url.origin : null;
}

export async function launchInstalledOperatorClient(
  client: InstalledOperatorClient,
  args: readonly string[],
): Promise<number> {
  const { id, repository, originEnv } = providers[client];
  const config = resolveRuntimeConfig();
  const service = (await discoverServices(config.servicesRoot)).find(candidate => candidate.manifest.id === id);
  const artifact = service?.manifest.artifact;
  if (!service || service.manifest.role !== "provider" || service.manifest.enabled === false
      || artifact?.source.repo !== repository || !artifact.source.tag
      || artifact.source.channel || artifact.source.tag.toLowerCase() === "latest") {
    throw new Error(`No pinned release provider ${id} is configured in the selected services root.`);
  }

  const selected = selectArtifactPlatform(artifact.platforms);
  if (!selected) throw new Error(`Provider ${id} has no release for this host platform and architecture.`);
  const definition = selected.definition;
  const sha256 = definition.checksum?.value ?? definition.sha256;
  const unavailable = () => new Error(`Provider ${id} is not prepared from its pinned release. Install and configure it through Core before launching.`);
  if (!sha256 || !definition.assetName || !definition.command) throw unavailable();
  const state = parseLifecycleState(service, await readStoredState(service.serviceRoot));
  const installed = state?.installArtifacts.artifact;
  if (!state?.installed || !state.configured || !installed?.extractedPath
      || installed.sourceType !== "github-release" || installed.repo !== repository
      || installed.tag !== artifact.source.tag || installed.assetName !== definition.assetName
      || installed.archiveType !== definition.archiveType || installed.command !== definition.command
      || installed.checksum?.assetName !== definition.assetName
      || installed.checksum.expected !== sha256 || installed.checksum.actual !== sha256) {
    throw unavailable();
  }

  const executable = await (async () => {
    try {
      const root = await realpath(service.serviceRoot);
      const extracted = await realpath(installed.extractedPath!);
      const command = await realpath(path.resolve(extracted, definition.command!));
      if (contained(root, extracted) && contained(extracted, command) && (await stat(command)).isFile()) {
        return command;
      }
    } catch {
      // Missing and replaced files have the same operator recovery.
    }
    throw unavailable();
  })();

  const env = { ...process.env };
  const forwarded = [...(definition.args ?? []), ...args];
  if (selectCheckoutTarget(client, forwarded, env) && !(client === "cli" && await cliHasSavedTarget())) {
    const origin = await checkoutOrigin(config).catch(() => {
      throw new Error("Cannot verify the running Core for this checkout. Run service-lasso instance or select an explicit connection.");
    });
    if (origin) env[originEnv] = origin;
    else if (client === "tui") forwarded.unshift("--connect");
    else throw new Error("No running Core found for this checkout. Run service-lasso start or pass --core-url.");
  }

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, forwarded, { cwd: process.cwd(), env, shell: false, stdio: "inherit" });
    child.once("error", () => reject(new Error(`Unable to launch installed provider ${id}.`)));
    child.once("exit", (status) => resolve(status ?? 1));
  });
}
