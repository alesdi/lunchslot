"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { postJson, storage, useRecentMeetings } from "@/lib/client";
import { formatDuration } from "@/lib/format";
import { FormError, SubmitButton } from "./form-bits";

const DURATIONS = [15, 30, 45, 60, 90];

export function CreateForm() {
  const router = useRouter();
  const titleId = useId();
  const recent = useRecentMeetings();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Presets from meetings created in this browser: distinct title + length combinations, newest first.
  const presets = recent
    .filter((m, i, all) => all.findIndex((o) => o.title === m.title && o.durationMin === m.durationMin) === i)
    .slice(0, 4);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { slug } = await postJson<{ slug: string }>("/api/meetings", { title, durationMin: duration });
      storage.addRecent({ slug, title: title.trim(), durationMin: duration });
      router.push(`/m/${slug}/share`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {presets.length > 0 && (
        <div>
          <div className="mb-2 font-semibold">Start from a recent meeting</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  setTitle(p.title);
                  setDuration(p.durationMin);
                  setCustom(!DURATIONS.includes(p.durationMin));
                }}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-ink"
              >
                {p.title || "Untitled"}, {formatDuration(p.durationMin)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label htmlFor={titleId} className="mb-2 block font-semibold">
          Title <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="Project kickoff"
          className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 outline-none placeholder:text-muted/70 focus:border-ink"
        />
      </div>

      <div>
        <div id="duration-label" className="mb-2 font-semibold">
          How long?
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-labelledby="duration-label" className="flex rounded-lg border border-line bg-surface p-1">
            {DURATIONS.map((d) => (
              <label
                key={d}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 ${
                  !custom && duration === d ? "bg-ink font-semibold text-paper" : "text-muted hover:text-ink"
                }`}
              >
                <input
                  type="radio"
                  name="duration"
                  checked={!custom && duration === d}
                  onChange={() => {
                    setCustom(false);
                    setDuration(d);
                  }}
                  className="sr-only"
                />
                {formatDuration(d)}
              </label>
            ))}
            <label
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm has-[:focus-visible]:outline-2 ${
                custom ? "bg-ink font-semibold text-paper" : "text-muted hover:text-ink"
              }`}
            >
              <input type="radio" name="duration" checked={custom} onChange={() => setCustom(true)} className="sr-only" />
              Other
            </label>
          </div>
          {custom && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-20 rounded-lg border border-line bg-surface px-3 py-1.5 outline-none focus:border-ink"
                aria-label="Length in minutes"
              />
              minutes
            </label>
          )}
        </div>
      </div>

      <FormError error={error} />
      <SubmitButton busy={busy} busyLabel="Creating…" disabled={!(duration >= 5 && duration <= 480)}>
        Create meeting
      </SubmitButton>
    </form>
  );
}
