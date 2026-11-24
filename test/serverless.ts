import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// Do not invoke a real conversation or provider. Empty verified Meta events
// exercise acknowledgement and Vercel's continuation registration without sends.
process.env.VERCEL = "1";
process.env.WHATSAPP_APP_SECRET = "serverless-fixture-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "serverless-fixture-verify";
process.env.DASHBOARD_LOCAL_ACCESS = "true";
const tasks: Promise<unknown>[] = [];
const key = Symbol.for("@vercel/request-context");
Object.defineProperty(globalThis, key, { configurable:true, value:{get:()=>({waitUntil:(task:Promise<unknown>)=>tasks.push(task)})} });
const { default: app } = await import("../src/server");
const server=app.listen(0,"127.0.0.1");
await new Promise<void>(resolve=>server.once("listening",resolve));
const address=server.address();assert(address&&typeof address!=="string");
const base=`http://127.0.0.1:${address.port}`;
try {
  assert.equal((await fetch(`${base}/healthz`)).status,200);
  assert.equal((await fetch(base,{redirect:"manual"})).headers.get("location"),"/dashboard/");
  for(const path of ["/dashboard/","/dashboard/dashboard.js","/dashboard/dashboard.css","/privacy/meridian-booking-pilot"])assert.equal((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(`${base}/dashboard/api/local-session`,{method:"POST",headers:{Origin:base}})).status,403,"Vercel must never enable local bootstrap");
  assert.equal((await fetch(`${base}/cron/practitioner`,{method:"POST"})).status,401);
  assert.equal((await fetch(`${base}/webhook`,{method:"POST",headers:{"Content-Type":"application/json"},body:'{}'})).status,401);
  const body='{ "object": "whatsapp_business_account", "entry": [] }';
  const signature="sha256="+createHmac("sha256",process.env.WHATSAPP_APP_SECRET!).update(body).digest("hex");
  const headers={"Content-Type":"application/json","X-Hub-Signature-256":signature};
  assert.equal((await fetch(`${base}/webhook`,{method:"POST",headers,body:body+" "})).status,401,"raw-byte mismatch must fail");
  assert.equal(tasks.length,0);
  assert.equal((await fetch(`${base}/webhook`,{method:"POST",headers,body})).status,200);
  assert.equal(tasks.length,1,"verified processing must be retained with waitUntil");
  await Promise.all(tasks);
  const verify=`${base}/webhook?hub.mode=subscribe&hub.verify_token=${process.env.WHATSAPP_VERIFY_TOKEN}&hub.challenge=serverless-ok`;
  assert.equal(await fetch(verify).then(r=>r.text()),"serverless-ok");
  console.log("Serverless smoke passed: static assets, privacy, closed auth, raw HMAC, immediate webhook acknowledgement and Vercel continuation.");
} finally { server.close(); Reflect.deleteProperty(globalThis,key); }
