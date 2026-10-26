import { date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Interval } from "@/lib/availability/expand";
import type { ParsedAvailability } from "@/lib/availability/schema";

const tsz = (name: string) => timestamp(name, { withTimezone: true });

export const meetings = pgTable("meetings", {
  id: text("id").primaryKey(),
  title: text("title"),
  durationMin: integer("duration_min").notNull(),
  horizonDays: integer("horizon_days").notNull().default(21),
  createdAt: tsz("created_at").notNull().defaultNow(),
  expiresAt: tsz("expires_at").notNull(),
  /** Last time calendar links were re-read; refreshes run at most once a day. */
  refreshedAt: tsz("refreshed_at"),
});

export const PARTICIPANT_SOURCES = ["link", "screenshot", "text", "calendar"] as const;
export type ParticipantSource = (typeof PARTICIPANT_SOURCES)[number];

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tz: text("tz").notNull(),
    rawText: text("raw_text").notNull().default(""),
    source: text("source", { enum: PARTICIPANT_SOURCES }).notNull().default("text"),
    parsed: jsonb("parsed").$type<ParsedAvailability>().notNull(),
    editTokenHash: text("edit_token_hash").notNull(),
    /** Busy blocks read from a connected Google Calendar (free/busy only), subtracted from `parsed`. */
    calendarBusy: jsonb("calendar_busy").$type<Interval[]>(),
    /** Encrypted Google refresh token while the calendar stays connected. Never sent to clients. */
    googleToken: text("google_token"),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("participants_meeting_idx").on(t.meetingId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: tsz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const llmSpend = pgTable("llm_spend", {
  day: date("day").primaryKey(),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  calls: integer("calls").notNull().default(0),
});
