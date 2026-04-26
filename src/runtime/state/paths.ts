import path from "node:path";

export interface ServiceStatePaths {
  stateRoot: string;
  service: string;
  meta: string;
  install: string;
  updates: string;
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
    config: path.join(stateRoot, "config.json"),
    runtime: path.join(stateRoot, "runtime.json"),
    backups: path.join(stateRoot, "backups"),
    artifacts: path.join(stateRoot, "artifacts"),
    updateCandidates: path.join(stateRoot, "update-candidates"),
    extracted: path.join(stateRoot, "extracted"),
  };
}
