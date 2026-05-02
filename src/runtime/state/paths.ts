import path from "node:path";

export interface ServiceStatePaths {
  stateRoot: string;
  service: string;
  meta: string;
  install: string;
  updates: string;
  recovery: string;
  setup: string;
  config: string;
  runtime: string;
  backups: string;
  artifacts: string;
  updateCandidates: string;
  extracted: string;
}

export function getServiceStatePaths(serviceRoot: string): ServiceStatePaths {
  const stateRoot = path.join(serviceRoot, ".state");

  return {
    stateRoot,
    service: path.join(stateRoot, "service.json"),
    meta: path.join(stateRoot, "meta.json"),
    install: path.join(stateRoot, "install.json"),
    updates: path.join(stateRoot, "updates.json"),
    recovery: path.join(stateRoot, "recovery.json"),
    setup: path.join(stateRoot, "setup.json"),
    config: path.join(stateRoot, "config.json"),
    runtime: path.join(stateRoot, "runtime.json"),
    backups: path.join(stateRoot, "backups"),
    artifacts: path.join(stateRoot, "artifacts"),
    updateCandidates: path.join(stateRoot, "update-candidates"),
    extracted: path.join(stateRoot, "extracted"),
  };
}

export function resolveServiceRootPath(serviceRoot: string, candidate: string | null): string | null {
  if (!candidate) {
    return null;
  }

  return path.isAbsolute(candidate) ? candidate : path.resolve(serviceRoot, candidate);
}

export function relativizeServiceRootPath(serviceRoot: string, candidate: string | null): string | null {
  if (!candidate || !path.isAbsolute(candidate)) {
    return candidate;
  }

  const relativePath = path.relative(serviceRoot, candidate);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return candidate;
  }

  return relativePath.split(path.sep).join("/");
}
