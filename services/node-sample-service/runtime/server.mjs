import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const heartbeat = setInterval(() => {}, 1000);

async function writeProviderEnvSnapshot() {
  const targetPath = path.resolve(process.cwd(), process.env.NODE_SAMPLE_ENV_PATH ?? "./.state/provider-env.json");
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    JSON.stringify(
      {
        NODE_ENV: process.env.NODE_ENV ?? null,
        SERVICE_PORT: process.env.SERVICE_PORT ?? null,
        NODE_SAMPLE_PORT: process.env.NODE_SAMPLE_PORT ?? null,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function shutdown() {
  clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

void writeProviderEnvSnapshot();
