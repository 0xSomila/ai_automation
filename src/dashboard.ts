import { Router, type Request } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createSupabaseServerClient } from "./db/client.js";

// This pilot endpoint is read-only and locked to one server-selected business.
// It intentionally exposes no phone numbers, message histories or service keys.
export function dashboardRouter(): Router {
  const router = Router();
  const sessions = new Map<string, number>();
  const cookieName = "c7_dashboard";
  const sessionAge = 8 * 60 * 60 * 1000;
  const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/dashboard" };
  const secureCookie = (req: Request) => Boolean(process.env.VERCEL) || req.secure;
  function validToken(value: string): boolean {
    const a = Buffer.from(process.env.DASHBOARD_ACCESS_TOKEN || ""), b = Buffer.from(value);
    return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
  }
  function signature(payload: string): string {
    return createHmac("sha256", process.env.DASHBOARD_ACCESS_TOKEN || "")
      .update(`c7-dashboard:${process.env.DASHBOARD_CLIENT_SLUG || "meridian"}:${payload}`).digest("base64url");
  }
  const sessionId = (req: Request) => req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  function hasSession(req: Request): boolean {
    const id = sessionId(req);
    if (!id) return false;
    if (id.startsWith("v1.") && (process.env.DASHBOARD_ACCESS_TOKEN?.length || 0) >= 32) {
      const parts = id.split(".");
      if (parts.length !== 4 || !/^\d+$/.test(parts[1]) || !/^[a-f0-9]{32}$/.test(parts[2])) return false;
      const expires = Number(parts[1]);
      const expected = Buffer.from(signature(`${parts[1]}.${parts[2]}`)), supplied = Buffer.from(parts[3]);
      return expires > Date.now() && expires <= Date.now() + sessionAge && expected.length === supplied.length && timingSafeEqual(expected, supplied);
    }
    const expires = sessions.get(id);
    if (expires && expires > Date.now()) return true;
    sessions.delete(id);
    return false;
  }
  // A tunnel also connects from loopback, so the Host and proxy-header checks
  // are essential. Only the local browser's exact same-origin POST can mint a
  // session. Remote dashboards continue to require their separate access token.
  function localBrowser(req: Request): boolean {
    return !process.env.VERCEL && process.env.DASHBOARD_LOCAL_ACCESS === "true" &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress || "") &&
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i.test(req.get("host") || "") &&
      !["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip"].some(h => req.get(h));
  }
  const sameOrigin = (req: Request) => req.get("origin") === `${process.env.VERCEL ? "https" : req.protocol}://${req.get("host")}`;
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });
  router.get("/api/session", (req, res) => res.json({ authenticated: hasSession(req), localAvailable: localBrowser(req) }));
  router.post("/api/token-session", (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403);
    if (!validToken(req.header("authorization")?.replace(/^Bearer /, "") || "")) return res.sendStatus(401);
    const payload = `${Date.now() + sessionAge}.${randomBytes(16).toString("hex")}`;
    res.cookie(cookieName, `v1.${payload}.${signature(payload)}`, { ...cookieOptions, secure: secureCookie(req), maxAge: sessionAge });
    return res.json({ ok: true });
  });
  router.post("/api/local-session", (req, res) => {
    if (!localBrowser(req) || !sameOrigin(req)) return res.sendStatus(403);
    for (const [id, expires] of sessions) if (expires <= Date.now()) sessions.delete(id);
    if (sessions.size >= 20) return res.status(429).json({ error: "too_many_local_sessions" });
    const previous = sessionId(req);
    if (previous) sessions.delete(previous);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, Date.now() + sessionAge);
    res.cookie(cookieName, id, { ...cookieOptions, secure: secureCookie(req), maxAge: sessionAge });
    return res.json({ ok: true });
  });
  router.post("/api/logout", (req, res) => {
    if (!sameOrigin(req)) return res.sendStatus(403);
    const id = sessionId(req);
    if (id) sessions.delete(id);
    res.clearCookie(cookieName, { ...cookieOptions, secure: secureCookie(req) });
    return res.json({ ok: true });
  });
  router.get("/api/appointments", async (req, res) => {
    const supplied = req.header("authorization")?.replace(/^Bearer /, "") ?? "";
    if (!hasSession(req) && !validToken(supplied)) {
      const configured = (process.env.DASHBOARD_ACCESS_TOKEN?.length || 0) >= 32 || process.env.DASHBOARD_LOCAL_ACCESS === "true";
      return res.status(configured ? 401 : 503).json({ error: configured ? "access_denied" : "connection_not_configured" });
    }
    const date = typeof req.query.date === "string" ? req.query.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: "invalid_date" });
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: "database_not_configured" });
    try {
      const db = createSupabaseServerClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const business = process.env.DASHBOARD_CLIENT_SLUG || "meridian";
      // Meridian is a South African pilot. Fixed UTC+02 has no daylight saving.
      const start = new Date(`${date}T00:00:00+02:00`);
      const end = new Date(start.getTime() + 7 * 86400000);
      const { data, error } = await db.from("engagements")
        .select("id,service,resource,starts_at,duration_min,status,reference,payload,reminder_sent_at")
        .eq("business_id", business).eq("kind", "appointment")
        .gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString())
        .order("starts_at").limit(500);
      if (error) throw error;
      return res.json({ mode: "pilot", timezone: "Africa/Johannesburg", readOnly: true, fetchedAt: new Date().toISOString(), appointments: (data ?? []).map(row => ({
        id: row.id, name: row.payload?.bookingName || "Booked patient", service: row.service || "Appointment",
        practitioner: row.resource || "unassigned", startsAt: row.starts_at, duration: row.duration_min || 30,
        status: row.status, reference: row.reference || "", reminder: row.reminder_sent_at ? "Provider accepted" : "Not recorded",
      })) });
    } catch {
      return res.status(502).json({ error: "bookings_unavailable" });
    }
  });
  const assets = new Set(["dashboard.css", "dashboard.js"]);
  router.get("/:asset", (req, res, next) => {
    if (!assets.has(req.params.asset)) return next();
    return res.sendFile(fileURLToPath(new URL(`../public/dashboard/${req.params.asset}`, import.meta.url)));
  });
  router.get("/", (_req, res) => res.sendFile(fileURLToPath(new URL("../public/dashboard/index.html", import.meta.url))));
  return router;
}
