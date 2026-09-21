export function resolveExamplePorts(env = process.env) {
  const defaults = { core: 18550, database: 18551, app: 18552 };
  const names = { core: 'LASSO_EXAMPLE_CORE_PORT', database: 'LASSO_EXAMPLE_DATABASE_PORT', app: 'LASSO_EXAMPLE_APP_PORT' };
  const ports = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = env[names[key]];
    if (value === undefined) return [key, fallback];
    if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
      throw new Error(`${names[key]} must be an integer from 1024 through 65535.`);
    }
    return [key, Number(value)];
  }));
  if (new Set(Object.values(ports)).size !== 3) throw new Error('Example Core, database and app ports must be distinct.');
  return ports;
}
