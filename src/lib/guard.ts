import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, llmSpend, rateLimits } from "@/db";
import { UserError } from "./errors";

export class GuardError extends UserError {
  constructor(message: string) {
    super(message, 429);
  }
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const LIMITS = {
  dailyBudgetUsd: num(process.env.DAILY_LLM_BUDGET_USD, 2),
  parsesPer10Min: num(process.env.RATE_PARSES_PER_10MIN, 8),
  parsesPerDay: num(process.env.RATE_PARSES_PER_DAY, 40),
  meetingsPerHour: num(process.env.RATE_MEETINGS_PER_HOUR, 10),
};

export function clientKey(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256")
    .update(`${process.env.IP_HASH_SALT ?? "lunchslot"}:${ip}`)
    .digest("base64url")
    .slice(0, 22);
}

async function hit(key: string, windowMs: number, max: number, message: string) {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const [row] = await db()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  if (Math.random() < 0.02) {
    await db().delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 2 * DAY)));
  }
  if (row.count > max) throw new GuardError(message);
}

export async function limitParse(client: string) {
  const msg = "You're going a bit fast. Please wait a few minutes and try again.";
  await hit(`parse:10m:${client}`, 10 * MIN, LIMITS.parsesPer10Min, msg);
  await hit(`parse:1d:${client}`, DAY, LIMITS.parsesPerDay, "You've hit today's limit for reading availability. Try again tomorrow.");
}

export async function limitMeetingCreate(client: string) {
  await hit(`meeting:1h:${client}`, 60 * MIN, LIMITS.meetingsPerHour, "Too many new meetings from your network. Try again in an hour.");
}

const today = () => new Date().toISOString().slice(0, 10);

export async function checkBudget() {
  const [row] = await db()
    .select({ cost: llmSpend.costUsd })
    .from(llmSpend)
    .where(sql`${llmSpend.day} = ${today()}`);
  if ((row?.cost ?? 0) >= LIMITS.dailyBudgetUsd) {
    throw new GuardError(
      "Lunchslot's free AI budget for today is used up. Try again tomorrow, or come back with your availability then.",
    );
  }
}

export async function recordSpend(costUsd: number) {
  await db()
    .insert(llmSpend)
    .values({ day: today(), costUsd, calls: 1 })
    .onConflictDoUpdate({
      target: llmSpend.day,
      set: { costUsd: sql`${llmSpend.costUsd} + ${costUsd}`, calls: sql`${llmSpend.calls} + 1` },
    });
}
