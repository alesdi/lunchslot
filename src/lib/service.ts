import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { db, meetings, participants, type ParticipantSource } from "@/db";
import { checkBudget, clientKey, limitMeetingCreate, limitParse, recordSpend } from "./guard";
import { ingest } from "./ingest";
import { findUrls } from "./ingest/page-reader";
import { findSlots, type Slot } from "./match";
import { UserError } from "./errors";
import { DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS } from "./horizon";

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
});
export type SubmissionInput = z.infer<typeof SubmissionInput>;

type Availability = Omit<SubmissionInput, "name">;

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
      horizonDays: MAX_HORIZON_DAYS,
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
  await getMeetingRow(slug);
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

  const parsed = await parseSubmission(req, input, MAX_HORIZON_DAYS);
  const source = sourceOf(input);

  if (existing) {
    await db()
      .update(participants)
      .set({ name: input.name, tz: input.tz, rawText: input.text, source, parsed, updatedAt: new Date() })
      .where(eq(participants.id, existing.id));
    return { participantId: existing.id, editToken: input.editToken! };
  }
  const editToken = randomBytes(24).toString("base64url");
  const [p] = await db()
    .insert(participants)
    .values({ meetingId: slug, name: input.name, tz: input.tz, rawText: input.text, source, parsed, editTokenHash: hashToken(editToken) })
    .returning({ id: participants.id });
  return { participantId: p.id, editToken };
}

// Anyone with the meeting link is trusted to remove or replace anyone's entry. What they can't do is
// read someone else's raw availability: that only comes back to its owner, via getOwnEntry.
export async function removeParticipant(slug: string, id: string) {
  const [p] = await db()
    .delete(participants)
    .where(and(eq(participants.id, id), eq(participants.meetingId, slug)))
    .returning({ id: participants.id });
  if (!p) throw notFound("That person is no longer in this meeting.");
}

export const ReplacementInput = SubmissionInput.omit({ name: true });

/** Overwrites someone's availability without revealing what they had; their name and edit token stay. */
export async function replaceAvailability(req: Request, slug: string, id: string, input: Availability) {
  await getMeetingRow(slug);
  const [existing] = await db()
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.id, id), eq(participants.meetingId, slug)));
  if (!existing) throw notFound("That person is no longer in this meeting.");
  const parsed = await parseSubmission(req, input, MAX_HORIZON_DAYS);
  const source = sourceOf(input);
  await db()
    .update(participants)
    .set({ tz: input.tz, rawText: input.text, source, parsed, updatedAt: new Date() })
    .where(eq(participants.id, id));
}

export type MeetingView = {
  slug: string;
  title: string | null;
  durationMin: number;
  /** How far ahead `slots` were searched. */
  horizonDays: number;
  participants: {
    id: string;
    name: string;
    tz: string;
    source: ParticipantSource;
    updatedAt: string;
    /** False when none of their times fall within the range, so they aren't counted in the slots. */
    hasTimes: boolean;
  }[];
  slots: Slot[];
};

export async function getMeetingView(slug: string, horizonDays = DEFAULT_HORIZON_DAYS): Promise<MeetingView> {
  const m = await getMeetingRow(slug);
  const rows = await db()
    .select({
      id: participants.id,
      name: participants.name,
      tz: participants.tz,
      source: participants.source,
      parsed: participants.parsed,
      updatedAt: participants.updatedAt,
    })
    .from(participants)
    .where(eq(participants.meetingId, slug))
    .orderBy(asc(participants.createdAt));
  const { slots, idle } = findSlots(rows, { durationMin: m.durationMin, now: Date.now(), horizonDays });
  return {
    slug,
    title: m.title,
    durationMin: m.durationMin,
    horizonDays,
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
 * Re-reads every calendar link in the meeting so the slots reflect bookings made since. Anyone can ask,
 * but the work runs at most once per REFRESH_EVERY_HOURS per meeting; otherwise this is a no-op.
 * Written and screenshot entries are kept as submitted.
 */
export async function refreshMeeting(slug: string, horizonDays = DEFAULT_HORIZON_DAYS): Promise<MeetingView> {
  await getMeetingRow(slug);
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
  if (!claimed) return getMeetingView(slug, horizonDays);

  const queue = await db()
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, slug), eq(participants.source, "link")));
  const startedAt = claimed.refreshedAt!;
  const refreshOne = async (p: (typeof queue)[number]) => {
    try {
      const parsed = await ingest(
        { text: p.rawText, images: [], tz: p.tz, now: Date.now(), horizonDays: MAX_HORIZON_DAYS },
        // No per-visitor rate limit: the daily claim above already caps how often this runs.
        { beforeLlm: checkBudget, afterLlm: recordSpend },
      );
      await db()
        .update(participants)
        .set({ parsed, updatedAt: new Date() })
        // Skip if the participant edited their entry while we were reading the old link.
        .where(and(eq(participants.id, p.id), lt(participants.updatedAt, startedAt)));
    } catch (e) {
      // Keep the last good reading: the link may be down, or today's budget may be spent.
      const what = `Refresh of ${slug}/${p.id} (${findUrls(p.rawText)[0]}) failed`;
      if (e instanceof UserError) console.warn(`${what}: ${e.message}`);
      else console.error(`${what}:`, e);
    }
  };
  await Promise.all(
    Array.from({ length: REFRESH_CONCURRENCY }, async () => {
      for (let p = queue.shift(); p; p = queue.shift()) await refreshOne(p);
    }),
  );
  return getMeetingView(slug, horizonDays);
}

/** Raw text of your own entry, so you can edit it. */
export async function getOwnEntry(slug: string, participantId: string, editToken: string) {
  const [p] = await db()
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, slug)));
  if (!p || !tokenMatches(editToken, p.editTokenHash)) throw notFound();
  return { name: p.name, tz: p.tz, text: p.rawText };
}
