import path from "node:path";

export interface ServiceStatePaths {
  stateRoot: string;
  service: string;
  install: string;
  config: string;
  runtime: string;
  backups: string;
}

export function getServiceStatePaths(serviceRoot: string): ServiceStatePaths {
  const stateRoot = path.join(serviceRoot, ".state");

  return {
    stateRoot,
    service: path.join(stateRoot, "service.json"),
    install: path.join(stateRoot, "install.json"),
    config: path.join(stateRoot, "config.json"),
    runtime: path.join(stateRoot, "runtime.json"),
    backups: path.join(stateRoot, "backups"),
  };
}
