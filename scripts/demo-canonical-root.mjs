import path from "node:path";
import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { demoServiceIds, repoRoot } from "./demo-instance-lib.mjs";

export const demoSourceServicesRoot = path.join(repoRoot, "services");
export const canonicalDemoServicesRoot = path.join(repoRoot, "workspace", "canonical-services-root");

function sameResolvedPath(left, right) {
  const leftResolved = path.resolve(String(left ?? ""));
  const rightResolved = path.resolve(String(right ?? ""));
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function gitBuffer(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `git ${args.join(" ")} failed with exit ${code}`));
    });
  });
}

async function gitText(args) {
  return (await gitBuffer(args)).toString("utf8");
}

function serviceGitRoot(serviceId) {
  return `services/${serviceId}`;
}

function shouldSeedServiceFile(relativePath) {
  const firstSegment = relativePath.split(/[\\/]/)[0];
  return firstSegment !== ".state" && firstSegment !== "logs" && firstSegment !== "temp";
}

async function listCommittedServiceFiles(serviceId) {
  const root = serviceGitRoot(serviceId);
  const output = await gitText(["ls-tree", "-r", "--name-only", "HEAD", "--", root]);
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${root}/`));
}

async function seedServiceFromCommittedTree(serviceId, servicesRoot) {
  const gitRoot = serviceGitRoot(serviceId);
  const manifestPath = `${gitRoot}/service.json`;
  const files = await listCommittedServiceFiles(serviceId);

  if (!files.includes(manifestPath)) {
    throw new Error(
      `Canonical demo seed source is missing committed manifest ${manifestPath}. Fix the baseline manifest in git; demo startup must not depend on dirty runtime folders.`,
    );
  }

  const targetRoot = path.join(servicesRoot, serviceId);
  await rm(targetRoot, { recursive: true, force: true });

  for (const file of files) {
    const relativePath = file.slice(gitRoot.length + 1);
    if (!relativePath || !shouldSeedServiceFile(relativePath)) {
      continue;
    }

    const targetPath = path.join(targetRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, await gitBuffer(["show", `HEAD:${file}`]));
  }
}

export async function seedCanonicalDemoServicesRoot(servicesRoot, options = {}) {
  const targetServicesRoot = path.resolve(servicesRoot ?? canonicalDemoServicesRoot);
  await mkdir(targetServicesRoot, { recursive: true });

  for (const serviceId of demoServiceIds) {
    const manifestPath = path.join(targetServicesRoot, serviceId, "service.json");
    if (options.replace !== true && await pathExists(manifestPath)) {
      continue;
    }
    await seedServiceFromCommittedTree(serviceId, targetServicesRoot);
  }

  return targetServicesRoot;
}

export async function prepareCanonicalDemoOptions(options, seedOptions = {}) {
  const requestedServicesRoot = path.resolve(options.servicesRoot ?? demoSourceServicesRoot);
  const servicesRoot = sameResolvedPath(requestedServicesRoot, demoSourceServicesRoot)
    ? canonicalDemoServicesRoot
    : requestedServicesRoot;

  await seedCanonicalDemoServicesRoot(servicesRoot, seedOptions);

  return {
    ...options,
    servicesRoot,
  };
}
