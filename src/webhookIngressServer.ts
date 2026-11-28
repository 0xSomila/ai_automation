import "dotenv/config";
import { createWebhookIngress } from "./webhookIngress.js";

const upstreamPort = Number(process.env.WEBHOOK_CORE_PORT || process.env.PORT || 3000);
const port = Number(process.env.WEBHOOK_INGRESS_PORT || 3101);
createWebhookIngress(upstreamPort).listen(port, "127.0.0.1", () => {
  console.info(`WhatsApp-only ingress on 127.0.0.1:${port}; Core port ${upstreamPort}`);
});
