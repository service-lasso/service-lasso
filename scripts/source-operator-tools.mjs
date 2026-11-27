import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sourceTools = Object.freeze({
  cli: Object.freeze({ url: 'https://github.com/service-lasso/service-lasso-cli.git', commit: 'b6383e1b125bdf1626ce380f9a36ffdd8bc001ae' }),
  tui: Object.freeze({ url: 'https://github.com/service-lasso/service-lasso-tui.git', commit: 'dcce6f29e6d5ce313055cc5e9267d32588d27450' }),
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
  if (!pin) throw new Error('Choose cli or tui.');
  const cache = path.join(root, '.operator-tools');
  const destination = path.join(cache, `${name}-${pin.commit}`);
  const binary = path.join(destination, name === 'cli' ? 'dist/index.js' : `service-lasso-tui${process.platform === 'win32' ? '.exe' : ''}`);
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
    if (name === 'cli') {
      // npm's JS entrypoint avoids invoking npm.cmd through a shell on Windows.
      if (!process.env.npm_execpath) throw new Error('Run operator setup through npm run operator:setup.');
      await build(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], staging);
      await build(process.execPath, [process.env.npm_execpath, 'run', 'build'], staging);
    } else {
      await build('go', ['build', '-trimpath', '-o', path.basename(binary), './cmd/service-lasso-tui'], staging);
    }
    await writeFile(path.join(staging, '.source-ready'), pin.commit);
    await rename(staging, destination);
    return binary;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const [name, ...forwarded] = args;
  if (name === 'setup' && forwarded.length === 0) {
    for (const tool of Object.keys(sourceTools)) await prepareTool(tool);
    console.log('Source operator tools ready. Use npm run cli -- instance status or npm run tui.');
    return;
  }
  if (!Object.hasOwn(sourceTools, name ?? '')) throw new Error('Usage: npm run operator:setup | npm run cli -- <args> | npm run tui -- <args>');
  const executable = await prepareTool(name);
  if (name === 'cli') await run(process.execPath, [executable, ...forwarded], root);
  else await run(executable, forwarded, root);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[operator-tools] ${error.message}`); process.exitCode = error.exitCode || 1; });
}
