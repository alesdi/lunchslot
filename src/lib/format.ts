export const formatDuration = (d: number) =>
  d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`;

export function meetingTitle(m: { title: string | null; durationMin: number }) {
  return m.title || `${formatDuration(m.durationMin)} meeting`;
}
