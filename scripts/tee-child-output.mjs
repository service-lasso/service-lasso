import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const [outPath, command, ...args] = process.argv.slice(2);
if (!outPath || !command) process.exit(2);
const out = createWriteStream(outPath);
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (data) => process.stdout.write(data));
child.stderr.on("data", (data) => {
  process.stderr.write(data);
  out.write(data);
});
child.on("close", (code) => {
  out.end(() => process.exit(code ?? 1));
});
