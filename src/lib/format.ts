export const formatDuration = (d: number) =>
  d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`;

export function meetingTitle(m: { title: string | null; durationMin: number }) {
  return m.title || `${formatDuration(m.durationMin)} meeting`;
}

const AGE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];

/** "just now", "5 minutes ago", "yesterday", … */
export function timeAgo(iso: string, now: number) {
  const ms = now - new Date(iso).getTime();
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of AGE_UNITS) if (ms >= size) return fmt.format(-Math.floor(ms / size), unit);
  return "just now";
}
