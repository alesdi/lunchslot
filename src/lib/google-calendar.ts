import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Interval } from "./availability/expand";
import { UserError } from "./errors";

// Reads a person's Google Calendar free/busy through the official Calendar API. Only busy blocks are ever
// requested (scope calendar.freebusy): no event titles, attendees or details.

const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const GRANT_TTL_MS = 60 * 60_000;

export const calendarEnabled = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.CALENDAR_TOKEN_KEY);

/** The person removed Lunchslot's access, or Google expired it. */
export class CalendarAccessError extends UserError {
  constructor() {
    super("Lunchslot no longer has access to that Google Calendar. Connect it again.", 403);
  }
}

export const callbackUrl = (origin: string) => `${origin}/api/google/callback`;
export const STATE_COOKIE = "lunchslot_google_state";

/** What the consent popup posts back to the form that opened it. */
export type CalendarMessage = { type: "lunchslot:calendar"; grant?: string; error?: string };

export function authorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: SCOPE,
    // Offline access with forced consent, so every connection gets its own refresh token: Google only
    // returns one on first consent otherwise, and a person can connect in several meetings.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data: data as { access_token?: string; refresh_token?: string; scope?: string; error?: string } };
}

/** Exchanges the authorization code from the consent screen for a refresh token. */
export async function exchangeCode(code: string, origin: string): Promise<string> {
  const { ok, data } = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(origin) });
  if (!ok || !data.refresh_token) throw new Error(`Google token exchange failed: ${data.error ?? "no refresh token"}`);
  if (!data.scope?.split(" ").includes(SCOPE)) {
    await revoke(data.refresh_token);
    throw new UserError("Google didn't share your calendar's availability. Try again and allow access.");
  }
  return data.refresh_token;
}

export async function accessToken(refreshToken: string): Promise<string> {
  const { ok, data } = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (data.error === "invalid_grant") throw new CalendarAccessError();
  if (!ok || !data.access_token) throw new Error(`Google token refresh failed: ${data.error ?? "no access token"}`);
  return data.access_token;
}

type FreeBusyResponse = { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> };

/** Busy blocks of the primary calendar from a freeBusy response, as epoch-millisecond intervals. */
export function busyFrom(res: FreeBusyResponse): Interval[] {
  const cal = res.calendars?.primary;
  if (!cal || cal.errors?.length) throw new Error(`Google freeBusy error: ${cal?.errors?.map((e) => e.reason).join(", ") ?? "no primary calendar"}`);
  return (cal.busy ?? [])
    .map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
    .filter((i) => Number.isFinite(i.s) && Number.isFinite(i.e) && i.e > i.s);
}

export async function readBusy(token: string, from: number, to: number): Promise<Interval[]> {
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: "primary" }] }),
  });
  if (res.status === 401 || res.status === 403) throw new CalendarAccessError();
  if (!res.ok) throw new Error(`Google freeBusy failed: ${res.status}`);
  return busyFrom(await res.json());
}

/** Reads busy blocks with a stored refresh token. */
export async function readCalendar(refreshToken: string, from: number, to: number): Promise<Interval[]> {
  return readBusy(await accessToken(refreshToken), from, to);
}

/** Revokes Lunchslot's access for this connection. Best effort: a failure only leaves an unused grant behind. */
export async function revoke(refreshToken: string): Promise<void> {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch((e) => console.warn("Google token revoke failed:", e));
}

// Refresh tokens are encrypted at rest (AES-256-GCM). The purpose is bound in as associated data, so a
// value sealed for one use (handing a fresh grant to the browser) can't be passed off as another.
type Purpose = "stored" | "grant";

const key = () => {
  const k = Buffer.from(process.env.CALENDAR_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CALENDAR_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return k;
};

function seal(plain: string, purpose: Purpose): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv).setAAD(Buffer.from(purpose));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

function open(sealed: string, purpose: Purpose): string | null {
  try {
    const buf = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12)).setAAD(Buffer.from(purpose));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sealStored = (refreshToken: string) => seal(refreshToken, "stored");
export const openStored = (sealed: string) => open(sealed, "stored");

/** A fresh connection, handed to the browser until the form is submitted. Only this server can read it. */
export const sealGrant = (refreshToken: string, now = Date.now()) => seal(JSON.stringify({ rt: refreshToken, at: now }), "grant");

export function openGrant(sealed: string, now = Date.now()): string {
  const raw = open(sealed, "grant");
  const g = raw ? (JSON.parse(raw) as { rt: string; at: number }) : null;
  if (!g || now - g.at > GRANT_TTL_MS) throw new UserError("Your Google Calendar connection expired. Connect it again.");
  return g.rt;
}
