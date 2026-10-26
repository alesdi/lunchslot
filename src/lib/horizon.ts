// How far ahead the best times are searched. The viewer picks a range on the results screen.

export const HORIZONS = [
  { days: 7, label: "Next 7 days" },
  { days: 14, label: "Next 2 weeks" },
  { days: 28, label: "Next 4 weeks" },
  { days: 60, label: "Next 2 months" },
] as const;

export const DEFAULT_HORIZON_DAYS = 7;
/** Entries are always read this far ahead, so switching ranges never re-reads or re-parses anything. */
export const MAX_HORIZON_DAYS = 60;

/** One of the offered ranges, falling back to the default for anything else. */
export const toHorizonDays = (v: unknown): number => HORIZONS.find((h) => h.days === Number(v))?.days ?? DEFAULT_HORIZON_DAYS;

/** "next 2 weeks", for use mid-sentence. */
export const horizonPhrase = (days: number) => (HORIZONS.find((h) => h.days === days)?.label ?? `Next ${days} days`).toLowerCase();
