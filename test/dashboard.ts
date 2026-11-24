import assert from "node:assert/strict";
import express from "express";
import { randomBytes } from "node:crypto";
import { dashboardRouter } from "../src/dashboard.js";

// Run without dotenv: these checks must never use the pilot database.
const saved = { token: process.env.DASHBOARD_ACCESS_TOKEN, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY, local: process.env.DASHBOARD_LOCAL_ACCESS };
delete process.env.DASHBOARD_ACCESS_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.DASHBOARD_LOCAL_ACCESS;
const app = express();
app.use("/dashboard", dashboardRouter());
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.on("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/dashboard`;
const originalFetch = globalThis.fetch;
try {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Protected practice workspace/);
  assert(!html.includes("C7-DEMO"));
  assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/api/appointments?date=2026-11-24`)).status, 503);
  const origin = new URL(base).origin;
  assert.equal((await fetch(`${base}/api/local-session`, {method:"POST",headers:{Origin:origin}})).status, 403, "local access is opt-in");
  process.env.DASHBOARD_LOCAL_ACCESS = "true";
  assert.equal((await fetch(`${base}/api/local-session`, {method:"POST"})).status, 403, "origin required");
  assert.equal((await fetch(`${base}/api/local-session`, {method:"POST",headers:{Origin:"https://attacker.invalid"}})).status, 403);
  for (const header of ["X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "Forwarded", "CF-Connecting-IP"]) {
    assert.equal((await fetch(`${base}/api/local-session`, {method:"POST",headers:{Origin:origin,[header]:"127.0.0.1"}})).status, 403, `${header} cannot mint a local session`);
  }
  assert.equal((await fetch(`${base}/api/local-session`, {method:"POST",headers:{Host:"pilot.trycloudflare.com",Origin:"http://pilot.trycloudflare.com"}})).status, 403, "tunnel host cannot mint local session");
  const session = await fetch(`${base}/api/local-session`, {method:"POST",headers:{Origin:origin}});
  assert.equal(session.status, 200);
  const cookie = session.headers.get("set-cookie")!;
  assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);assert.match(cookie,/Path=\/dashboard/i);
  const cookieHeader = {Cookie:cookie.split(";")[0]};
  assert.equal((await fetch(`${base}/api/session`, {headers:cookieHeader}).then(r=>r.json())).authenticated, true);
  assert.equal((await fetch(`${base}/api/appointments?date=bad`, {headers:cookieHeader})).status, 400, "cookie authenticates without a bearer token");
  assert.equal((await fetch(`${base}/api/logout`, {method:"POST",headers:cookieHeader})).status, 403, "logout requires same origin");
  assert.equal((await fetch(`${base}/api/logout`, {method:"POST",headers:{...cookieHeader,Origin:origin}})).status, 200);
  assert.equal((await fetch(`${base}/api/session`, {headers:cookieHeader}).then(r=>r.json())).authenticated, false);
  delete process.env.DASHBOARD_LOCAL_ACCESS;
  const token = randomBytes(32).toString("hex");
  process.env.DASHBOARD_ACCESS_TOKEN = token;
  assert.equal((await fetch(`${base}/api/appointments?date=2026-11-24`)).status, 401);
  assert.equal((await fetch(`${base}/api/appointments?date=2026-11-24`, {headers:{Authorization:`Bearer ${"x".repeat(token.length)}`}})).status, 401);
  const headers = {Authorization:`Bearer ${token}`};
  assert.equal((await fetch(`${base}/api/token-session`, {method:"POST",headers})).status,403);
  assert.equal((await fetch(`${base}/api/token-session`, {method:"POST",headers:{Origin:origin,Authorization:"Bearer invalid"}})).status,401);
  const hostedSession = await fetch(`${base}/api/token-session`,{method:"POST",headers:{...headers,Origin:origin}});
  assert.equal(hostedSession.status,200);
  const hostedCookie=hostedSession.headers.get("set-cookie")!.split(";")[0];
  const secondApp=express();secondApp.use("/dashboard",dashboardRouter());
  const secondServer=secondApp.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>secondServer.once("listening",resolve));
  try {
    const secondAddress=secondServer.address();assert(secondAddress&&typeof secondAddress!=="string");
    const secondBase=`http://127.0.0.1:${secondAddress.port}/dashboard`;
    assert.equal((await fetch(`${secondBase}/api/appointments?date=bad`,{headers:{Cookie:hostedCookie}})).status,400,"signed session survives a separate function instance");
    assert.equal((await fetch(`${secondBase}/api/appointments?date=bad`,{headers:{Cookie:hostedCookie+"tampered"}})).status,401);
  } finally { secondServer.close(); }
  for (const date of ["2026-02-30", "2026-13-01", "2026-11-24T00:00:00Z", "bad"]) {
    assert.equal((await fetch(`${base}/api/appointments?date=${date}`, {headers})).status, 400);
  }
  assert.equal((await fetch(`${base}/api/appointments?date=2026-11-24`, {headers})).status, 503);
  assert.equal((await fetch(`${base}/api/appointments`, {method:"POST",headers})).status, 404, "dashboard exposes no booking mutation route");
  // Stub the database transport to prove business scope and output minimisation.
  process.env.SUPABASE_URL = "https://dashboard-test.invalid";
  process.env.SUPABASE_SERVICE_KEY = `x.${Buffer.from(JSON.stringify({role:"service_role"})).toString("base64url")}.x`;
  let queries = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "dashboard-test.invalid") return originalFetch(input, init);
    queries++;
    assert.equal(url.searchParams.get("business_id"), "eq.meridian");
    assert.equal(url.searchParams.get("kind"), "eq.appointment");
    assert.equal(url.searchParams.get("limit"), "500");
    assert.deepEqual(url.searchParams.getAll("starts_at"), ["gte.2026-11-23T22:00:00.000Z", "lt.2026-11-30T22:00:00.000Z"]);
    assert(!url.searchParams.get("select")!.includes("customers"));
    return new Response(JSON.stringify([{id:"fixture",service:"Initial consultation",resource:null,starts_at:"2026-11-24T07:00:00Z",duration_min:45,status:"confirmed",reference:"C7-TEST",payload:{bookingName:"Fictional Test",privateField:"must not leak"},reminder_sent_at:null}]),{status:200,headers:{"content-type":"application/json"}});
  };
  const snapshot = await fetch(`${base}/api/appointments?date=2026-11-24&business=other-practice`, {headers});
  assert.equal(snapshot.status, 200);
  const body = await snapshot.json();
  assert.equal(queries, 1);
  assert.equal(body.readOnly, true);
  assert.equal(body.appointments[0].practitioner, "unassigned");
  assert.equal(body.appointments[0].name, "Fictional Test");
  assert(!JSON.stringify(body).includes("privateField"));
  assert(!JSON.stringify(body).includes("payload"));
  console.log("Dashboard checks passed: local session opt-in, origin and tunnel guards, HttpOnly cookie, logout, bearer auth, date validation, tenant scope and minimal read-only response.");
} finally {
  globalThis.fetch = originalFetch;
  server.close();
  for (const [key,value] of [["DASHBOARD_ACCESS_TOKEN",saved.token],["SUPABASE_URL",saved.url],["SUPABASE_SERVICE_KEY",saved.key],["DASHBOARD_LOCAL_ACCESS",saved.local]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
}
