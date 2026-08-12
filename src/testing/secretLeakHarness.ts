export interface SecretLeakSentinel {
  label: string;
  value: string;
  description: string;
}

export interface SecretLeakFinding {
  path: string;
  kind: "sentinel" | "credential-shape";
  label: string;
  excerpt: string;
}

export interface SecretLeakScanOptions {
  sentinels?: SecretLeakSentinel[];
  includeDefaultCredentialShapes?: boolean;
}

export const serviceLassoSecretLeakSentinels: SecretLeakSentinel[] = [
  {
    label: "service-lasso-fake-token",
    value: "SERVICE_LASSO_FAKE_SECRET_SENTINEL_TOKEN_DO_NOT_USE",
    description:
      "Clearly fake project sentinel for token-like leak regression tests.",
  },
  {
    label: "service-lasso-fake-password",
    value: "SERVICE_LASSO_FAKE_SECRET_SENTINEL_PASSWORD_DO_NOT_USE",
    description:
      "Clearly fake project sentinel for password-like leak regression tests.",
  },
  {
    label: "service-lasso-fake-private-key",
    value: "-----BEGIN SERVICE LASSO FAKE PRIVATE KEY-----",
    description:
      "Clearly fake project sentinel for private-key-like leak regression tests.",
  },
];

const credentialShapePatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "bearer-token", pattern: /Bearer\s+[A-Za-z0-9._~+/-]{24,}/g },
  { label: "basic-auth-url", pattern: /https?:\/\/[^\s/:]+:[^\s/@]{6,}@/g },
  { label: "aws-access-key", pattern: /AKIA[0-9A-Z]{16}/g },
  { label: "github-token", pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/g },
  {
    label: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
];

function excerpt(value: string, index: number, length: number): string {
  const start = Math.max(0, index - 16);
  const end = Math.min(value.length, index + length + 16);
  return value.slice(start, end);
}

function collectStrings(
  input: unknown,
  path: string,
  output: Array<{ path: string; value: string }>,
): void {
  if (typeof input === "string") {
    output.push({ path, value: input });
    return;
  }
  if (input === null || input === undefined) {
    return;
  }
  if (
    typeof input === "number" ||
    typeof input === "boolean" ||
    typeof input === "bigint"
  ) {
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((entry, index) =>
      collectStrings(entry, `${path}[${index}]`, output),
    );
    return;
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>,
    )) {
      collectStrings(value, path ? `${path}.${key}` : key, output);
    }
  }
}

export function scanForSecretMaterial(
  input: unknown,
  options: SecretLeakScanOptions = {},
): SecretLeakFinding[] {
  const strings: Array<{ path: string; value: string }> = [];
  collectStrings(input, "$", strings);
  const findings: SecretLeakFinding[] = [];
  const sentinels = options.sentinels ?? serviceLassoSecretLeakSentinels;

  for (const item of strings) {
    for (const sentinel of sentinels) {
      const index = item.value.indexOf(sentinel.value);
      if (index >= 0) {
        findings.push({
          path: item.path,
          kind: "sentinel",
          label: sentinel.label,
          excerpt: excerpt(item.value, index, sentinel.value.length),
        });
      }
    }

    if (options.includeDefaultCredentialShapes !== false) {
      for (const { label, pattern } of credentialShapePatterns) {
        pattern.lastIndex = 0;
        for (const match of item.value.matchAll(pattern)) {
          findings.push({
            path: item.path,
            kind: "credential-shape",
            label,
            excerpt: excerpt(item.value, match.index ?? 0, match[0].length),
          });
        }
      }
    }
  }

  return findings;
}

export function assertNoSecretMaterial(
  input: unknown,
  options: SecretLeakScanOptions = {},
): void {
  const findings = scanForSecretMaterial(input, options);
  if (findings.length > 0) {
    const summary = findings
      .map((finding) => `${finding.kind}:${finding.label}@${finding.path}`)
      .join(", ");
    throw new Error(`Secret material leak detected: ${summary}`);
  }
}
