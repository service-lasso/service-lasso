import path from 'node:path';

export function postgresChildEnvironment(artifact, env = process.env, platform = process.platform) {
  const childEnv = { ...env };
  // The pinned Linux binaries ship libpq beside bin, without a relocatable
  // loader search path. Use only that owned directory, not ambient overrides.
  if (platform === 'linux') childEnv.LD_LIBRARY_PATH = path.posix.join(artifact, 'lib');
  return childEnv;
}
