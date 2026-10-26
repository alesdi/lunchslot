// Google Cloud Function that makes one kind of request on behalf of Lunchslot's link reader: Google
// Calendar booking pages load their slots from an API that answers 403 to Vercel's servers.
// Not an open proxy: callers need the shared secret, and only allowlisted hosts are reachable.
// Deploy: see README ("Google Calendar booking links").
import { timingSafeEqual } from "node:crypto";

const ALLOWED_HOSTS = new Set(["calendar-pa.clients6.google.com"]);
const FORWARD_HEADERS = ["accept", "content-type", "origin", "referer", "user-agent", "x-user-agent"];
const RETURN_HEADERS = [
  "content-type",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "access-control-max-age",
];

const secretMatches = (given) => {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(process.env.RELAY_SECRET ?? "");
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};

export async function relay(req, res) {
  if (req.method !== "POST" || !secretMatches(req.get("x-relay-secret"))) return res.status(403).send("Forbidden");
  const { url, method = "GET", headers = {}, body } = req.body ?? {};
  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).send("Bad URL");
  }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) return res.status(403).send("Host not allowed");

  const forwarded = Object.fromEntries(FORWARD_HEADERS.filter((h) => headers[h]).map((h) => [h, String(headers[h])]));
  try {
    const r = await fetch(target, { method, headers: forwarded, body: method === "GET" || method === "HEAD" ? undefined : body });
    res.json({
      status: r.status,
      headers: Object.fromEntries(RETURN_HEADERS.filter((h) => r.headers.has(h)).map((h) => [h, r.headers.get(h)])),
      body: Buffer.from(await r.arrayBuffer()).toString("base64"),
    });
  } catch (e) {
    res.status(502).send(`Upstream failed: ${e.message}`);
  }
}
