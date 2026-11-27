import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { access, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sourceTools = Object.freeze({
  cli: Object.freeze({ url: 'https://github.com/service-lasso/service-lasso-cli.git', commit: 'b6383e1b125bdf1626ce380f9a36ffdd8bc001ae' }),
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// No shell: user arguments and inherited credentials never become command text.
export function buildEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith('SERVICE_LASSO_')));
}

export function run(command, args, cwd, { capture = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'inherit', windowsHide: false });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', () => reject(new Error(`Cannot run ${path.basename(command)}. Install the documented prerequisite and retry npm run operator:setup.`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(Object.assign(new Error(`${path.basename(command)} failed${signal ? ` (${signal})` : ` (exit ${code})`}.`), { exitCode: code || 1 }));
    });
  });
}

export async function prepareTool(name) {
  const pin = Object.hasOwn(sourceTools, name) ? sourceTools[name] : undefined;
  if (!pin) throw new Error('Choose cli. The TUI is installed through the Core service manifest.');
  const cache = path.join(root, '.operator-tools');
  const destination = path.join(cache, `${name}-${pin.commit}`);
  const binary = path.join(destination, 'dist/index.js');
  try {
    if ((await readFile(path.join(destination, '.source-ready'), 'utf8')) === pin.commit) return binary;
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read operator cache. Check .operator-tools permissions.'); }
  await mkdir(cache, { recursive: true });
  const lock = path.join(cache, `${name}.lock`);
  try { await mkdir(lock); } catch { throw new Error(`Another ${name} setup may be running. Wait for it; if it was interrupted, remove .operator-tools/${name}.lock and retry.`); }
  let staging;
  const build = (command, args, cwd, options = {}) => run(command, args, cwd, { ...options, env: buildEnvironment() });
  try {
    staging = await mkdtemp(path.join(cache, `${name}-build-`));
    // init + fetch exact commit avoids discovering or checking out any branch.
    await build('git', ['init', '--quiet', staging], root);
    await build('git', ['-c', 'credential.interactive=false', 'fetch', '--quiet', '--depth=1', pin.url, pin.commit], staging);
    const actual = await build('git', ['rev-parse', 'FETCH_HEAD'], staging, { capture: true });
    if (actual !== pin.commit) throw new Error('Operator source commit mismatch; refusing to build.');
    await build('git', ['checkout', '--quiet', '--detach', pin.commit], staging);
    // npm's JS entrypoint avoids invoking npm.cmd through a shell on Windows.
    if (!process.env.npm_execpath) throw new Error('Run operator setup through npm run operator:setup.');
    await build(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], staging);
    await build(process.execPath, [process.env.npm_execpath, 'run', 'build'], staging);
    await writeFile(path.join(staging, '.source-ready'), pin.commit);
    await rename(staging, destination);
    return binary;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

const hasFlag = (args, ...names) => args.some(arg => names.some(name => arg === name || arg.startsWith(name + '=')));

function usesCheckoutTarget(args, environment) {
  if (hasFlag(args, '--help', '-help', '-h', '--version', '-V')) return false;
  const [group, action] = args.filter(arg => !arg.startsWith('-'));
  const runtimeCommand = group === 'instance' || group === 'operator'
    || (group === 'service' && ['list', 'register', 'operation'].includes(action));
  return runtimeCommand && !hasFlag(args, '--core-url', '--connection')
    && !environment.SERVICE_LASSO_CORE_URL
    && !environment.SERVICE_LASSO_CONNECTION;
}

export async function checkoutRuntimeOrigin() {
  const configPath = new URL('../dist/runtime/config.js', import.meta.url);
  try { await access(configPath); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const [{ resolveRuntimeConfig }, { discoverRuntimeLane }] = await Promise.all([
    import(configPath.href),
    import('../dist/runtime/instance/registry.js'),
  ]);
  const config = resolveRuntimeConfig({
    servicesRoot: path.resolve(root, process.env.SERVICE_LASSO_SERVICES_ROOT || 'services'),
    workspaceRoot: path.resolve(root, process.env.SERVICE_LASSO_WORKSPACE_ROOT || 'workspace'),
  });
  const lane = await discoverRuntimeLane(config);
  if (lane.classification !== 'selected' || !lane.endpoint) return null;
  const url = URL.parse(lane.endpoint);
  if (!url || url.protocol !== 'http:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) return null;
  const loopback = ['localhost', '[::1]'].includes(url.hostname)
    || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.'));
  return loopback ? url.origin : null;
}

export async function sourceClientInvocation(name, args, environment = process.env, resolveOrigin = checkoutRuntimeOrigin) {
  if (!Object.hasOwn(sourceTools, name) || !usesCheckoutTarget(args, environment)) return { args, env: environment };
  const origin = await resolveOrigin().catch(() => {
    throw new Error('Cannot verify the running Core for this checkout. Run npm run status or select an explicit connection.');
  });
  if (!origin) {
    throw new Error('No running Core found for this checkout. Run npm start in this workspace or pass --core-url.');
  }
  return { args, env: { ...environment, SERVICE_LASSO_CORE_URL: origin } };
}

export async function main(args = process.argv.slice(2)) {
  const [name, ...forwarded] = args;
  if (name === 'setup' && forwarded.length === 0) {
    for (const tool of Object.keys(sourceTools)) await prepareTool(tool);
    console.log('Source CLI ready. Use npm run cli -- instance status.');
    return;
  }
  if (!Object.hasOwn(sourceTools, name ?? '')) throw new Error('Usage: npm run operator:setup | npm run cli -- <args>');
  const { args: clientArgs, env } = await sourceClientInvocation(name, forwarded);
  const executable = await prepareTool(name);
  await run(process.execPath, [executable, ...clientArgs], root, { env });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[operator-tools] ${error.message}`); process.exitCode = error.exitCode || 1; });
}
