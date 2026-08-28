export function optionalNetworkValue(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function requireNetworkValue(value, message) {
  const resolved = optionalNetworkValue(value);
  if (!resolved) {
    throw new Error(message);
  }
  return resolved;
}

export function buildParameterizedHttpUrl(host, port, pathname = "/") {
  const resolvedHost = requireNetworkValue(host, "A network host parameter is required.");
  if (/[/@?#\s]/.test(resolvedHost)) {
    throw new Error(`Invalid network host parameter ${JSON.stringify(resolvedHost)}.`);
  }
  const urlHost = resolvedHost.includes(":") && !resolvedHost.startsWith("[")
    ? `[${resolvedHost}]`
    : resolvedHost;
  return new URL(`http://${urlHost}:${port}${pathname}`).toString();
}
