import { createServer, request } from "node:http";

// The public tunnel terminates here, never at the dashboard or cron surface.
// Forward raw webhook bytes unchanged so the Core can verify Meta's signature.
export function createWebhookIngress(upstreamPort: number) {
  return createServer((incoming, outgoing) => {
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.setHeader("X-Content-Type-Options", "nosniff");
    let url: URL;
    try { url = new URL(incoming.url || "/", "http://webhook.local"); }
    catch { outgoing.writeHead(400).end(); return; }
    if (url.pathname !== "/webhook") { outgoing.writeHead(404).end(); return; }
    if (!["GET", "POST"].includes(incoming.method || "")) { outgoing.writeHead(405, { Allow: "GET, POST" }).end(); return; }
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "content-length", "x-hub-signature-256"]) {
      const value = incoming.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const upstream = request({ hostname: "127.0.0.1", port: upstreamPort, method: incoming.method,
      path: `/webhook${url.search}`, headers, timeout: 20000 }, response => {
      outgoing.writeHead(response.statusCode || 502, { "Content-Type": response.headers["content-type"] || "text/plain" });
      response.pipe(outgoing);
      response.on("error", () => outgoing.destroy());
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    incoming.on("aborted", () => upstream.destroy());
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
}
