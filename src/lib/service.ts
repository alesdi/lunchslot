import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { db, meetings, participants, type ParticipantSource } from "@/db";
import type { ParsedAvailability } from "./availability/schema";
import { checkBudget, clientKey, limitMeetingCreate, limitParse, recordSpend } from "./guard";
import { ingest } from "./ingest";
import { findUrls } from "./ingest/page-reader";
import { findSlots, type Slot } from "./match";
import { UserError } from "./errors";
import { CalendarAccessError, openGrant, openStored, readCalendar, revoke, sealStored } from "./google-calendar";

const notFound = (msg = "Not found.") => new UserError(msg, 404);

const MAX_PARTICIPANTS = 20;
const MEETING_TTL_DAYS = 60;
const REFRESH_EVERY_HOURS = 24;
// Each link read launches its own headless Chromium, so keep a handful in flight at once.
const REFRESH_CONCURRENCY = 3;
const newSlug = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 10);

const isTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const SubmissionInput = z.object({
  name: z.string().trim().min(1, "Add your name.").max(40, "That name is a bit long."),
  tz: z.string().refine(isTz, "Unknown timezone."),
  text: z.string().max(4000, "Keep it under 4,000 characters.").default(""),
  images: z
    .array(z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,/, "Unsupported image.").max(1_500_000, "Image too large."))
    .max(2, "Up to 2 images.")
    .default([]),
  /** A Google Calendar connection fresh from the consent popup, sealed by /api/google/callback. */
  calendarGrant: z.string().max(4000).optional(),
  /** Editing your own entry: keep the calendar that's already connected. */
  keepCalendar: z.boolean().default(false),
});
export type SubmissionInput = z.infer<typeof SubmissionInput>;

type Availability = Pick<SubmissionInput, "tz" | "text" | "images">;

/** What a calendar-only entry parses to: nothing written, so working hours minus the calendar's busy blocks. */
const NOTHING_WRITTEN: ParsedAvailability = {
  statedTimezone: null,
  free: [],
  busy: [],
  bookingStarts: [],
  bookingSlotMinutes: null,
  preferences: [],
  unparseable: false,
};
const hasWritten = (input: Availability) => input.text.trim().length > 0 || input.images.length > 0;

const sourceOf = (input: Availability): ParticipantSource =>
  findUrls(input.text).length ? "link" : input.images.length ? "screenshot" : "text";

export const CreateMeetingInput = z.object({
  title: z.string().trim().max(80, "Keep the title under 80 characters.").default(""),
  durationMin: z.number().int().min(5, "At least 5 minutes.").max(480, "At most 8 hours."),
});

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const tokenMatches = (token: string, hash: string) => {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
};

async function parseSubmission(req: Request, input: Availability, horizonDays: number) {
  const client = clientKey(req);
  return ingest(
    { text: input.text, images: input.images, tz: input.tz, now: Date.now(), horizonDays },
    {
      beforeLlm: async () => {
        await limitParse(client);
        await checkBudget();
      },
      afterLlm: recordSpend,
    },
  );
}

export async function createMeeting(req: Request, input: z.infer<typeof CreateMeetingInput>) {
  await limitMeetingCreate(clientKey(req));
  const id = newSlug();
  await db()
    .insert(meetings)
    .values({
      id,
      title: input.title || null,
      durationMin: input.durationMin,
      horizonDays: 21,
      expiresAt: new Date(Date.now() + MEETING_TTL_DAYS * 864e5),
    });
  if (Math.random() < 0.05) await db().delete(meetings).where(lt(meetings.expiresAt, new Date()));
  return { slug: id };
}

async function getMeetingRow(slug: string) {
  const [m] = await db().select().from(meetings).where(eq(meetings.id, slug));
  if (!m || m.expiresAt.getTime() < Date.now()) throw notFound("This meeting link doesn't exist or has expired.");
  return m;
}

export async function upsertParticipant(
  req: Request,
  slug: string,
  input: SubmissionInput & { participantId?: string; editToken?: string },
) {
  const m = await getMeetingRow(slug);
  let existing: typeof participants.$inferSelect | undefined;
  if (input.participantId && input.editToken) {
    [existing] = await db()
      .select()
      .from(participants)
      .where(and(eq(participants.id, input.participantId), eq(participants.meetingId, slug)));
    if (existing && !tokenMatches(input.editToken, existing.editTokenHash)) existing = undefined;
  }
  if (!existing) {
    const count = (await db().select({ id: participants.id }).from(participants).where(eq(participants.meetingId, slug))).length;
    if (count >= MAX_PARTICIPANTS) throw new UserError(`This meeting is full (${MAX_PARTICIPANTS} people max).`);
  }

  // The Google connection the entry ends up with: a new one, the one it already has, or none.
  const fresh = input.calendarGrant ? openGrant(input.calendarGrant) : null;
  const kept = !fresh && input.keepCalendar && existing?.googleToken ? openStored(existing.googleToken) : null;
  const token = fresh ?? kept;
  let values;
  try {
    // Calendar first: it's free, so a revoked connection fails before any LLM spend.
    const calendarBusy = token ? await readCalendar(token, Date.now(), Date.now() + m.horizonDays * 864e5) : null;
    const parsed = token && !hasWritten(input) ? NOTHING_WRITTEN : await parseSubmission(req, input, m.horizonDays);
    values = {
      name: input.name,
      tz: input.tz,
      rawText: input.text,
      source: token ? ("calendar" as const) : sourceOf(input),
      parsed,
      calendarBusy,
      googleToken: token ? sealStored(token) : null,
    };
  } catch (e) {
    // Don't leave a connection behind that no entry holds.
    if (fresh) await revoke(fresh);
    throw e;
  }

  if (existing) {
    await db()
      .update(participants)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(participants.id, existing.id));
    // Replaced or disconnected: revoke the old connection.
    const old = existing.googleToken && !kept ? openStored(existing.googleToken) : null;
    if (old) await revoke(old);
    return { participantId: existing.id, editToken: input.editToken! };
  }
  const editToken = randomBytes(24).toString("base64url");
  const [p] = await db()
    .insert(participants)
    .values({ meetingId: slug, ...values, editTokenHash: hashToken(editToken) })
    .returning({ id: participants.id });
  return { participantId: p.id, editToken };
}

/** Revokes an entry's Google connection, if it has one. */
async function revokeStored(sealed: string | null) {
  const token = sealed && openStored(sealed);
  if (token) await revoke(token);
}

// Anyone with the meeting link is trusted to remove or replace anyone's entry. What they can't do is
// read someone else's raw availability: that only comes back to its owner, via getOwnEntry.
export async function removeParticipant(slug: string, id: string) {
  const [p] = await db()
    .delete(participants)
    .where(and(eq(participants.id, id), eq(participants.meetingId, slug)))
    .returning({ id: participants.id, googleToken: participants.googleToken });
  if (!p) throw notFound("That person is no longer in this meeting.");
  await revokeStored(p.googleToken);
}

// Connecting a calendar is only for your own entry.
export const ReplacementInput = SubmissionInput.omit({ name: true, calendarGrant: true, keepCalendar: true });

/** Overwrites someone's availability without revealing what they had; their name and edit token stay. */
export async function replaceAvailability(req: Request, slug: string, id: string, input: Availability) {
  const m = await getMeetingRow(slug);
  const [existing] = await db()
    .select({ id: participants.id, googleToken: participants.googleToken })
    .from(participants)
    .where(and(eq(participants.id, id), eq(participants.meetingId, slug)));
  if (!existing) throw notFound("That person is no longer in this meeting.");
  const parsed = await parseSubmission(req, input, m.horizonDays);
  const source = sourceOf(input);
  // Their calendar no longer describes the entry, so it's disconnected.
  await db()
    .update(participants)
    .set({ tz: input.tz, rawText: input.text, source, parsed, calendarBusy: null, googleToken: null, updatedAt: new Date() })
    .where(eq(participants.id, id));
  await revokeStored(existing.googleToken);
}

export type MeetingView = {
  slug: string;
  title: string | null;
  durationMin: number;
  participants: {
    id: string;
    name: string;
    tz: string;
    source: ParticipantSource;
    updatedAt: string;
    /** False when none of their times are still ahead, so they aren't counted in the slots. */
    hasTimes: boolean;
  }[];
  slots: Slot[];
};

export async function getMeetingView(slug: string): Promise<MeetingView> {
  const m = await getMeetingRow(slug);
  const rows = await db()
    .select({
      id: participants.id,
      name: participants.name,
      tz: participants.tz,
      source: participants.source,
      parsed: participants.parsed,
      busy: participants.calendarBusy,
      updatedAt: participants.updatedAt,
    })
    .from(participants)
    .where(eq(participants.meetingId, slug))
    .orderBy(asc(participants.createdAt));
  const { slots, idle } = findSlots(rows, { durationMin: m.durationMin, now: Date.now(), horizonDays: m.horizonDays });
  return {
    slug,
    title: m.title,
    durationMin: m.durationMin,
    participants: rows.map((r) => ({
      id: r.id,
      name: r.name,
      tz: r.tz,
      source: r.source,
      updatedAt: r.updatedAt.toISOString(),
      hasTimes: !idle.includes(r.id),
    })),
    slots,
  };
}

/**
 * Re-reads every calendar link and connected Google Calendar in the meeting so the slots reflect bookings
 * made since. Anyone can ask, but the work runs at most once per REFRESH_EVERY_HOURS per meeting;
 * otherwise this is a no-op. Written and screenshot entries are kept as submitted.
 */
export async function refreshMeeting(slug: string): Promise<MeetingView> {
  const m = await getMeetingRow(slug);
  // Claim the refresh atomically so concurrent clicks don't each re-read every link.
  // A new meeting counts as fresh: none of its links can be older than the meeting itself.
  const [claimed] = await db()
    .update(meetings)
    .set({ refreshedAt: new Date() })
    .where(
      and(
        eq(meetings.id, slug),
        sql`coalesce(${meetings.refreshedAt}, ${meetings.createdAt}) < now() - make_interval(hours => ${REFRESH_EVERY_HOURS})`,
      ),
    )
    .returning({ refreshedAt: meetings.refreshedAt });
  if (!claimed) return getMeetingView(slug);

  const queue = await db()
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, slug), inArray(participants.source, ["link", "calendar"])));
  const startedAt = claimed.refreshedAt!;
  // Skip if the participant edited their entry while we were reading the old one.
  const unchanged = (id: string) => and(eq(participants.id, id), lt(participants.updatedAt, startedAt));
  const refreshOne = async (p: (typeof queue)[number]) => {
    try {
      if (p.source === "calendar") {
        const token = p.googleToken && openStored(p.googleToken);
        if (!token) return;
        try {
          const calendarBusy = await readCalendar(token, Date.now(), Date.now() + m.horizonDays * 864e5);
          await db().update(participants).set({ calendarBusy, updatedAt: new Date() }).where(unchanged(p.id));
        } catch (e) {
          // Access was revoked: stop trying, but keep the last busy blocks until they edit their entry.
          if (e instanceof CalendarAccessError) await db().update(participants).set({ googleToken: null }).where(unchanged(p.id));
          throw e;
        }
        return;
      }
      const parsed = await ingest(
        { text: p.rawText, images: [], tz: p.tz, now: Date.now(), horizonDays: m.horizonDays },
        // No per-visitor rate limit: the daily claim above already caps how often this runs.
        { beforeLlm: checkBudget, afterLlm: recordSpend },
      );
      await db().update(participants).set({ parsed, updatedAt: new Date() }).where(unchanged(p.id));
    } catch (e) {
      // Keep the last good reading: the link may be down, or today's budget may be spent.
      const what = `Refresh of ${slug}/${p.id} (${p.source === "calendar" ? "Google Calendar" : findUrls(p.rawText)[0]}) failed`;
      if (e instanceof UserError) console.warn(`${what}: ${e.message}`);
      else console.error(`${what}:`, e);
    }
  };
  await Promise.all(
    Array.from({ length: REFRESH_CONCURRENCY }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await refreshOne(p);
    }),
  );
  return getMeetingView(slug);
}

/** Raw text of your own entry, and whether a calendar is connected, so you can edit it. */
export async function getOwnEntry(slug: string, participantId: string, editToken: string) {
  const [p] = await db()
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, slug)));
  if (!p || !tokenMatches(editToken, p.editTokenHash)) throw notFound();
  return { name: p.name, tz: p.tz, text: p.rawText, calendarConnected: !!p.googleToken };
}
