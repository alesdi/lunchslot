import { z } from "zod";

// Everything the LLM returns is local wall-clock time, in `statedTimezone` if set, otherwise the
// participant's browser timezone. Conversion to absolute instants happens in expand.ts.
// Fields use `.nullable()` rather than `.optional()` so the schema works with strict
// structured-output modes across providers.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const Weekday = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof Weekday>;

const time = (what: string) => z.string().describe(`${what}, 24h "HH:MM" local time. "24:00" means end of day.`);
const date = z.string().describe('Calendar date "YYYY-MM-DD"');

export const TimeRange = z.object({
  date: date.nullable().describe("Set for a one-off date. Null when the range repeats on `weekdays`."),
  weekdays: z.array(Weekday).nullable().describe("Set for recurring ranges (e.g. every Tuesday). Null when `date` is set."),
  start: time("Start"),
  end: time("End"),
});
export type TimeRange = z.infer<typeof TimeRange>;

export const Preference = z.object({
  kind: z.enum(["avoid", "prefer"]),
  date: date.nullable(),
  weekdays: z.array(Weekday).nullable().describe("Null with null date means every day."),
  start: time("Start").nullable().describe("Null means the whole day."),
  end: time("End").nullable(),
  weight: z.number().int().min(1).max(3).describe("1 = mild, 2 = normal, 3 = strong"),
  label: z.string().describe('Very short human label, e.g. "lunch", "mornings", "Fridays"'),
});
export type Preference = z.infer<typeof Preference>;

export const ParsedAvailability = z.object({
  statedTimezone: z
    .string()
    .nullable()
    .describe('IANA timezone (e.g. "America/New_York") ONLY if the person explicitly says their times are in a specific timezone. Otherwise null.'),
  free: z.array(TimeRange).describe("When the person CAN meet."),
  busy: z.array(TimeRange).describe("When the person CANNOT meet (calendar events, exceptions, hard no's)."),
  bookingStarts: z
    .array(TimeRange)
    .describe(
      "Booking pages only: runs of offered START times copied as-is. start = first start time of the run, end = LAST START time of the run (equal to start for a single slot). Never add the meeting length.",
    ),
  bookingSlotMinutes: z.number().int().nullable().describe("Booking pages only: length of the bookable event in minutes, e.g. 30."),
  preferences: z.array(Preference),
  unparseable: z.boolean().describe("True when the input contains no usable availability information."),
});
export type ParsedAvailability = z.infer<typeof ParsedAvailability>;
