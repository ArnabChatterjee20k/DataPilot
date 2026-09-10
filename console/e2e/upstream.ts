import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";

/**
 * A small upstream service for the API client tests to call.
 *
 * The client's whole job is to make real requests, so the tests point it at a
 * real server rather than stubbing the network.
 */
export const UPSTREAM_PORT = 8021;
export const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;

export interface Upstream {
  server: Server;
  /** Close immediately, even with a websocket still attached. */
  stop: () => Promise<void>;
}

export function startUpstream(): Promise<Upstream> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", UPSTREAM_URL);
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");

      if (url.pathname === "/ping") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ pong: true }));
        return;
      }

      if (url.pathname === "/teapot") {
        response.writeHead(418, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "I am a teapot" }));
        return;
      }

      if (url.pathname === "/echo") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            headers: request.headers,
            body,
          })
        );
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
    socket.on("message", (data) => socket.send(`echo:${data}`));
  });

  return new Promise((resolve) => {
    server.listen(UPSTREAM_PORT, "127.0.0.1", () =>
      resolve({
        server,
        stop: () =>
          new Promise<void>((done) => {
            // an open websocket keeps server.close() waiting forever
            for (const socket of sockets.clients) socket.terminate();
            server.closeAllConnections();
            server.close(() => done());
          }),
      })
    );
  });
}

export const BROKER_PORT = 8022;
export const BROKER_URL = `mqtt://127.0.0.1:${BROKER_PORT}`;

export interface Broker {
  stop: () => Promise<void>;
}

/**
 * A real MQTT broker for the console to talk to.
 *
 * The point of the MQTT tab is acknowledgements and retained messages, and a
 * stub would have to fake both - which is exactly the bug the tab exists to
 * avoid shipping.
 */
export async function startBroker(): Promise<Broker> {
  const { Aedes } = await import("aedes");
  const { createServer: createTcpServer } = await import("node:net");

  const aedes = await Aedes.createBroker();
  // MQTT over plain TCP, which is what mqtt:// means; http.createServer here
  // would give a broker that only speaks MQTT-over-websockets
  const server = createTcpServer(aedes.handle as never);

  await new Promise<void>((resolve) =>
    server.listen(BROKER_PORT, "127.0.0.1", resolve)
  );

  return {
    stop: () =>
      new Promise<void>((done) => {
        aedes.close(() => server.close(() => done()));
      }),
  };
}
