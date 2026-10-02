// The observer starts this tiny Node-only gate in place of the Admin browser
// entrypoint.  It has no product imports: the target is imported only after
// the observer has fsync'd its OS-bound initial and activation records.
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const hex40 = /^[0-9a-f]{40}$/u;
const hex64 = /^[0-9a-f]{64}$/u;
const configPath = process.argv[2];
const targetArgs = process.argv.slice(3);

function exactKeys(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

async function privateJson(root, name) {
  const file = path.join(root, name);
  const metadata = await lstat(file).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1) return null;
  try {
    const text = await readFile(file, "utf8");
    if (text.length > 65_536) return null;
    return { value: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") };
  } catch { return null; }
}

function sameTuple(value, config) {
  return value?.nonce === config.nonce && value?.source?.head === config.source.head && value?.source?.tree === config.source.tree;
}

async function waitForActivation(config) {
  const rootMetadata = await lstat(config.root).catch(() => null);
  if (!rootMetadata?.isDirectory() || rootMetadata.isSymbolicLink()) throw new Error("observer_private_root_invalid");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const plan = await privateJson(config.root, "plan.json");
    const initial = await privateJson(config.root, "initial.json");
    const activation = await privateJson(config.root, "activation.json");
    if (plan && initial && activation
      && exactKeys(plan.value, ["schema", "private", "nonce", "source", "state", "startedAt", "provider", "inputs"])
      && plan.value.schema === "service-lasso.admin-provider-observer-plan.v2" && plan.value.private === true && plan.value.state === "PLAN" && sameTuple(plan.value, config)
      && exactKeys(initial.value, ["schema", "private", "nonce", "source", "plan", "state", "observer", "provider", "inputs", "startedAt"])
      && initial.value.schema === "service-lasso.admin-provider-observer-initial.v2" && initial.value.private === true && initial.value.plan === "plan.json" && initial.value.state === "INITIAL" && sameTuple(initial.value, config)
      && initial.value.provider?.pid === process.pid && initial.value.provider?.parentPid === process.ppid
      && typeof initial.value.provider?.birth === "string" && initial.value.provider.birth.length > 0
      && exactKeys(initial.value.provider?.nativeIdentity, ["path", "size", "sha256"])
      && typeof initial.value.provider.nativeIdentity.path === "string" && Number.isSafeInteger(initial.value.provider.nativeIdentity.size) && /^[0-9a-f]{64}$/u.test(initial.value.provider.nativeIdentity.sha256)
      && exactKeys(activation.value, ["schema", "private", "nonce", "source", "plan", "initial", "initialSha256", "state", "provider", "inputs"])
      && activation.value.schema === "service-lasso.admin-provider-observer-activation.v2" && activation.value.private === true && activation.value.plan === "plan.json" && activation.value.initial === "initial.json" && activation.value.initialSha256 === initial.sha256 && activation.value.state === "ACTIVATED" && sameTuple(activation.value, config)
      && JSON.stringify(activation.value.provider) === JSON.stringify(initial.value.provider)
      && JSON.stringify(activation.value.inputs) === JSON.stringify(plan.value.inputs)
      && JSON.stringify(initial.value.inputs) === JSON.stringify(plan.value.inputs)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("observer_activation_unavailable");
}

if (!configPath || targetArgs.length < 1) throw new Error("observer_bootstrap_arguments_invalid");
const configMetadata = await lstat(configPath).catch(() => null);
if (!configMetadata?.isFile() || configMetadata.isSymbolicLink() || configMetadata.size < 1 || configMetadata.size > 65_536) throw new Error("observer_config_invalid");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!config || typeof config !== "object" || typeof config.root !== "string" || !hex64.test(config.nonce) || !hex40.test(config.source?.head) || !hex40.test(config.source?.tree)) throw new Error("observer_config_invalid");
if (path.resolve(config.root) !== config.root || path.resolve(configPath) !== configPath) throw new Error("observer_config_path_invalid");
if (process.env.SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_ROOT !== config.root || process.env.SERVICE_LASSO_ADMIN_PROVIDER_OBSERVER_NONCE !== config.nonce) throw new Error("observer_activation_environment_invalid");
await waitForActivation(config);
// The target remains the observed Node process.  Restore its argv before the
// dynamic import so established fixtures still bind their own fixed pathname
// and command arguments rather than trusting this gate's bootstrap path.
process.argv.splice(1, process.argv.length - 1, ...targetArgs);
await import(pathToFileURL(path.resolve(targetArgs[0])).href);
