import { formatDuration, meetingTitle } from "@/lib/format";

export function MeetingHeading({ m, children }: { m: { title: string | null; durationMin: number }; children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{meetingTitle(m)}</h1>
      <p className="mt-1 text-muted">
        {formatDuration(m.durationMin)}
        {children}
      </p>
    </div>
  );
}
