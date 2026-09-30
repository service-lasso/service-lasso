import { once } from "node:events";
import { createApiServer } from "../../dist/server/index.js";

let serialized = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serialized += chunk;
const input = JSON.parse(serialized);
const server = createApiServer({
  servicesRoot: input.servicesRoot,
  workspaceRoot: input.workspaceRoot,
  mcpHttpIdentity: { env: input.env },
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address !== "object") throw new Error("Lifecycle peer did not receive a TCP address.");
process.stdout.write(`${JSON.stringify({ url: `http://127.0.0.1:${address.port}` })}\n`);
process.once("SIGTERM", () => server.close());
await once(server, "close");
