import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHealthResponse } from "./routes/health.js";
import { createServicesResponse } from "./routes/services.js";
import { FIXTURE_SERVICES } from "../fixtures/services.js";
import type { ServiceSummary } from "../contracts/api.js";

export interface ApiServerOptions {
  port?: number;
  version?: string;
  services?: ServiceSummary[];
}

export interface RunningApiServer {
  server: Server;
  port: number;
  url: string;
  stop: () => Promise<void>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

function notFound(response: ServerResponse): void {
  writeJson(response, 404, {
    error: "not_found",
    message: "Route not found.",
  });
}

function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<ApiServerOptions, "version" | "services">>,
): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/health") {
    writeJson(response, 200, createHealthResponse(options.version));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/services") {
    writeJson(response, 200, createServicesResponse(options.services));
    return;
  }

  notFound(response);
}

export function createApiServer(options: ApiServerOptions = {}): Server {
  const resolvedOptions = {
    version: options.version ?? "0.1.0",
    services: options.services ?? FIXTURE_SERVICES,
  };

  return createServer((request, response) => {
    routeRequest(request, response, resolvedOptions);
  });
}

export async function startApiServer(options: ApiServerOptions = {}): Promise<RunningApiServer> {
  const server = createApiServer(options);
  const port = options.port ?? 18080;

  server.listen(port, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("API server failed to expose a TCP address.");
  }

  const resolvedPort = address.port;

  return {
    server,
    port: resolvedPort,
    url: `http://127.0.0.1:${resolvedPort}`,
    stop: async () => {
      server.close();
      await once(server, "close");
    },
  };
}
