import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { Browser } from "puppeteer-core";
import { UserError } from "../errors";

// Reads any scheduling/booking link (Calendly, cal.com, zcal, SavvyCal, Google appointment pages, …)
// without provider-specific code: render it in headless Chromium, keep the visible text plus any JSON the
// page loads that contains timestamps (that's where slot data lives), and hand that digest to the LLM.

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const ISO_RE = /\b(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})\b/g;
const MAX_TEXT = 6_000;
const MAX_JSON_EACH = 25_000;
const MAX_DIGEST = 40_000;
const NAV_TIMEOUT = 15_000;

export class LinkError extends UserError {
  constructor(message: string) {
    super(message, 422);
  }
}

export function findUrls(text: string): string[] {
  // Trailing punctuation belongs to the sentence, not the link.
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))].slice(0, 1);
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/** Only public http(s) hosts: no localhost, private ranges, or cloud metadata endpoints. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LinkError("That link doesn't look valid.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new LinkError("Only regular web links are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new LinkError("That link isn't public.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!ips.length) throw new LinkError("We couldn't reach that link.");
  if (ips.some(isPrivateIp)) throw new LinkError("That link isn't public.");
  return url;
}

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
}

const DAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

/**
 * iCalendar recurrence rules (RFC 5545) are a common way booking tools describe weekly hours.
 * Spell them out ("repeats weekly on Mon at 10:30") so the model doesn't have to decode them.
 */
export function humanizeRRules(text: string): string {
  return text.replace(/(?:DTSTART:[0-9TZ]+\\n)?RRULE:([A-Z]+=[^\s"\\]+)(?:\\nEXDATE:[0-9TZ,]+)?/g, (m, rule: string) => {
    const parts = Object.fromEntries(rule.split(";").map((kv) => kv.split("=")));
    const freq = String(parts.FREQ ?? "").toLowerCase();
    const days = parts.BYDAY ? ` on ${parts.BYDAY.split(",").map((d: string) => DAYS[d.slice(-2)] ?? d).join(", ")}` : "";
    const at =
      parts.BYHOUR !== undefined ? ` at ${parts.BYHOUR.padStart(2, "0")}:${String(parts.BYMINUTE ?? "0").padStart(2, "0")}` : "";
    return freq ? `repeats ${freq}${days}${at}${at ? " (organizer's time zone)" : ""}` : m;
  });
}

/** Rewrites absolute timestamps into wall-clock time in `tz`, so the LLM never converts timezones. */
export function localizeTimestamps(text: string, tz: string): string {
  return text.replace(ISO_RE, (m) => {
    const t = Date.parse(m);
    return Number.isFinite(t) ? format(new TZDate(t, tz), "yyyy-MM-dd HH:mm") : m;
  });
}

/** Generic shrinking: drop empty values and collapse single-key wrappers like {"time": "…"} to their value. */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) {
    const arr = v.map(prune).filter((x) => x !== undefined);
    return arr.length ? arr : undefined;
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v)
      .map(([k, x]) => [k, prune(x)] as const)
      .filter(([, x]) => x !== undefined);
    if (entries.length === 0) return undefined;
    if (entries.length === 1 && typeof entries[0][1] !== "object") return entries[0][1];
    return Object.fromEntries(entries);
  }
  if (v === null || v === "" || v === false) return undefined;
  // URLs and long blobs (images, tokens, rich text) carry no availability.
  if (typeof v === "string" && (/^https?:\/\//.test(v) || v.length > 500)) return undefined;
  return v;
}

const LOCAL_TS = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;

/** Splits an array item into its single local timestamp and a signature of everything else. */
function timestampOf(item: unknown): { date: string; min: number; sig: string } | null {
  let ts: string | undefined;
  let sig = "";
  if (typeof item === "string") ts = item;
  else if (item && typeof item === "object" && !Array.isArray(item)) {
    const entries = Object.entries(item);
    const stamped = entries.filter(([, v]) => typeof v === "string" && LOCAL_TS.test(v));
    if (stamped.length !== 1) return null;
    ts = stamped[0][1] as string;
    const rest = Object.fromEntries(entries.filter(([k]) => k !== stamped[0][0]));
    sig = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  }
  const m = ts ? LOCAL_TS.exec(ts) : null;
  return m ? { date: m[1], min: Number(m[2]) * 60 + Number(m[3]), sig } : null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Booking tools list every bookable start time. Compress arrays of evenly spaced timestamps into runs
 * ("starts every 30 min from 2026-10-07 03:00 through 07:00"), which is shorter and far easier for a
 * small model to read correctly than hundreds of entries.
 */
function compressRuns(v: unknown): unknown {
  if (Array.isArray(v)) {
    const items = v.map(compressRuns);
    const stamps = items.map(timestampOf);
    if (items.length < 3 || stamps.some((x) => !x)) return items;
    const out: string[] = [];
    let i = 0;
    while (i < stamps.length) {
      const a = stamps[i]!;
      let j = i;
      const step = i + 1 < stamps.length ? stamps[i + 1]!.min - a.min : 0;
      while (
        j + 1 < stamps.length &&
        step > 0 &&
        stamps[j + 1]!.date === a.date &&
        stamps[j + 1]!.sig === a.sig &&
        stamps[j + 1]!.min - stamps[j]!.min === step
      )
        j++;
      out.push(
        j > i
          ? `starts every ${step} min from ${a.date} ${hhmm(a.min)} through ${hhmm(stamps[j]!.min)}${a.sig}`
          : `starts at ${a.date} ${hhmm(a.min)}${a.sig}`,
      );
      i = j + 1;
    }
    return out;
  }
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compressRuns(x)]));
  return v;
}

export function compactJson(body: string, max = MAX_JSON_EACH): string {
  let out: string;
  try {
    out = JSON.stringify(compressRuns(prune(JSON.parse(body)))) ?? "";
  } catch {
    out = body;
  }
  return out.length > max ? `${out.slice(0, max)}… (truncated: ignore the last, incomplete day)` : out;
}

export async function readPage(rawUrl: string, tz: string): Promise<string> {
  const url = await assertPublicUrl(rawUrl);
  const browser = await launch();
  const jsonBodies: { url: string; body: string }[] = [];
  const pending: Promise<void>[] = [];
  try {
    const page = await browser.newPage();
    await page.emulateTimezone(tz);
    await page.setUserAgent({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      let host = "";
      try {
        host = new URL(req.url()).hostname.replace(/^\[|\]$/g, "");
      } catch {}
      const blockedHost = host === "localhost" || (isIP(host) > 0 && isPrivateIp(host));
      if (blockedHost || type === "image" || type === "media" || type === "font") req.abort().catch(() => {});
      else req.continue().catch(() => {});
    });
    page.on("response", (res) => {
      const type = res.headers()["content-type"] ?? "";
      if (!type.includes("json") || jsonBodies.length >= 20) return;
      pending.push(
        res
          .text()
          .then((body) => {
            if (body.length > 500_000) return;
            if ((body.match(ISO_RE)?.length ?? 0) >= 3) jsonBodies.push({ url: res.url(), body });
          })
          .catch(() => {}),
      );
    });

    try {
      await page.goto(url.toString(), { waitUntil: "networkidle2", timeout: NAV_TIMEOUT });
    } catch {
      // Slow pages: keep whatever loaded so far.
    }
    // SPAs often fetch slot data after the first idle point.
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 5_000 }).catch(() => {});
    await Promise.all(pending);
    const title = await page.title().catch(() => "");
    const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");

    const parts = [`Linked page: ${url.toString()}`, `Title: ${title}`, `Visible text:\n${text.replace(/\n{3,}/g, "\n\n").slice(0, MAX_TEXT)}`];
    // SPAs often refetch the same endpoint: drop exact repeats, and per URL keep the most complete response.
    const byUrl = new Map<string, { url: string; body: string }>();
    for (const j of jsonBodies) {
      const prev = byUrl.get(j.url);
      if (!prev || j.body.length > prev.body.length) byUrl.set(j.url, j);
    }
    const seen = new Set<string>();
    for (const j of byUrl.values()) {
      if (seen.has(j.body)) continue;
      seen.add(j.body);
      parts.push(`Data loaded by the page from ${new URL(j.url).pathname}:\n${humanizeRRules(compactJson(localizeTimestamps(j.body, tz)))}`);
    }
    const digest = localizeTimestamps(parts.join("\n\n"), tz).slice(0, MAX_DIGEST);
    if (!text.trim() && !jsonBodies.length) throw new LinkError("We couldn't read that link. Paste your slots or a screenshot instead.");
    return digest;
  } finally {
    await browser.close().catch(() => {});
  }
}
