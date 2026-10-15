import { createServer } from "node:http";

export async function createOwnedUnavailableEndpoint() {
  const sockets = new Set();
  const server = createServer((_request, response) => response.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const url = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing owned unavailable loopback endpoint"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  return {
    url,
    async close() {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
