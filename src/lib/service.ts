import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { db, meetings, participants } from "@/db";
import { checkBudget, clientKey, limitMeetingCreate, limitParse, recordSpend } from "./guard";
import { ingest } from "./ingest";
import { findSlots, type Slot } from "./match";
import { UserError } from "./errors";

const notFound = (msg = "Not found.") => new UserError(msg, 404);

const MAX_PARTICIPANTS = 20;
const MEETING_TTL_DAYS = 60;
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

async function parseSubmission(req: Request, input: SubmissionInput, horizonDays: number) {
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

  const parsed = await parseSubmission(req, input, m.horizonDays);

  if (existing) {
    await db()
      .update(participants)
      .set({ name: input.name, tz: input.tz, rawText: input.text, parsed, updatedAt: new Date() })
      .where(eq(participants.id, existing.id));
    return { participantId: existing.id, editToken: input.editToken! };
  }
  const editToken = randomBytes(24).toString("base64url");
  const [p] = await db()
    .insert(participants)
    .values({ meetingId: slug, name: input.name, tz: input.tz, rawText: input.text, parsed, editTokenHash: hashToken(editToken) })
    .returning({ id: participants.id });
  return { participantId: p.id, editToken };
}

export async function removeParticipant(slug: string, participantId: string, editToken: string) {
  const [p] = await db()
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), eq(participants.meetingId, slug)));
  if (!p || !tokenMatches(editToken, p.editTokenHash)) throw notFound();
  await db().delete(participants).where(eq(participants.id, p.id));
}

export type MeetingView = {
  slug: string;
  title: string | null;
  durationMin: number;
  participants: { id: string; name: string; tz: string; summary: string }[];
  slots: Slot[];
};

export async function getMeetingView(slug: string): Promise<MeetingView> {
  const m = await getMeetingRow(slug);
  const rows = await db()
    .select({ id: participants.id, name: participants.name, tz: participants.tz, parsed: participants.parsed })
    .from(participants)
    .where(eq(participants.meetingId, slug))
    .orderBy(asc(participants.createdAt));
  const slots = findSlots(rows, { durationMin: m.durationMin, now: Date.now(), horizonDays: m.horizonDays });
  return {
    slug,
    title: m.title,
    durationMin: m.durationMin,
    participants: rows.map((r) => ({ id: r.id, name: r.name, tz: r.tz, summary: r.parsed.summary })),
    slots,
  };
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
