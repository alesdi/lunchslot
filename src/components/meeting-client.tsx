"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeetingView } from "@/lib/service";
import {
  copyText,
  isValidTz,
  postJson,
  storage,
  useOwner,
  useRecentMeetings,
  useStoredName,
  useViewerTz,
  type Ownership,
} from "@/lib/client";
import { AvailabilityInput } from "./availability-input";
import { FormError, NameField, SubmitButton } from "./form-bits";
import { MeetingHeading } from "./meeting-title";
import { SlotList } from "./slot-list";
import { CREATOR_STEPS, Steps } from "./steps";
import { TimezoneField } from "./timezone-field";

const POLL_MS = 5000;
const INVITEE_STEPS = ["Your availability", "Best times"];

export function MeetingClient({ initial }: { initial: MeetingView }) {
  const slug = initial.slug;
  const [view, setView] = useState(initial);
  const viewerTz = useViewerTz();
  const owner = useOwner(slug);
  const isCreator = useRecentMeetings().some((m) => m.slug === slug);
  const [editing, setEditing] = useState(false);
  const [peek, setPeek] = useState(false);
  const [copied, setCopied] = useState(false);

  const storedName = useStoredName();
  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? storedName;
  const [tzInput, setTz] = useState<string | null>(null);
  const tz = tzInput ?? viewerTz ?? "";
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/meetings/${slug}`, { cache: "no-store" });
    if (res.ok) setView(await res.json());
  }, [slug]);

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && refresh();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const me = owner ? view.participants.find((p) => p.id === owner.participantId) : undefined;
  const joined = !!me;
  const showForm = (!joined && !peek) || editing;
  const total = view.participants.length;

  async function copyLink() {
    if (await copyText(`${location.origin}/m/${slug}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  async function startEdit() {
    if (!owner) return;
    setError(null);
    try {
      const entry = await postJson<{ name: string; tz: string; text: string }>(`/api/meetings/${slug}/me`, owner);
      setName(entry.name);
      setTz(entry.tz);
      setText(entry.text);
      setImages([]);
      setEditing(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function leave() {
    if (!owner) return;
    await postJson(`/api/meetings/${slug}/participants`, owner, "DELETE").catch(() => {});
    storage.clearOwner(slug);
    setEditing(false);
    setText("");
    refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await postJson<Ownership>(`/api/meetings/${slug}/participants`, {
        name,
        tz,
        text,
        images,
        ...(joined && owner ? owner : {}),
      });
      storage.setOwner(slug, res);
      storage.setName(name);
      storage.setTz(tz);
      setEditing(false);
      setPeek(false);
      setText("");
      setImages([]);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const steps = isCreator ? CREATOR_STEPS : INVITEE_STEPS;
  const current = (isCreator ? 2 : 0) + (showForm ? 0 : 1);
  const othersIn = view.participants.filter((p) => p.id !== me?.id).map((p) => p.name);
  const hasLink = /https?:\/\//i.test(text);

  return (
    <div>
      <Steps steps={steps} current={current} />
      <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <MeetingHeading m={view}>
          {total > 0 && <>, {total === 1 ? "1 person" : `${total} people`} so far</>}
        </MeetingHeading>
        <button
          type="button"
          onClick={copyLink}
          className="rounded-lg border border-ink px-4 py-2 font-semibold hover:bg-ink hover:text-paper"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      {showForm ? (
        <section aria-labelledby="add">
          <h2 id="add" className="mb-1 text-xl font-bold">
            {editing ? "Edit your availability" : "When are you free?"}
          </h2>
          <p className="mb-6 text-muted">
            {othersIn.length > 0
              ? `${othersIn.join(", ")} ${othersIn.length === 1 ? "has" : "have"} already replied.`
              : "You're the first. Others will see the best times once they add theirs."}
          </p>
          <form onSubmit={submit} className="space-y-6">
            <div className="flex flex-col gap-6 sm:flex-row">
              <NameField value={name} onChange={setName} disabled={busy} />
              <TimezoneField value={tz} onChange={setTz} disabled={busy} />
            </div>
            <AvailabilityInput text={text} onText={setText} images={images} onImages={setImages} disabled={busy} />
            <FormError error={error} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <SubmitButton
                busy={busy}
                busyLabel={hasLink ? "Opening your link…" : "Reading your availability…"}
                disabled={!name.trim() || !isValidTz(tz) || (!text.trim() && !images.length)}
              >
                {editing ? "Save changes" : "Add my availability"}
              </SubmitButton>
              {editing ? (
                <button type="button" onClick={() => setEditing(false)} className="text-muted underline underline-offset-2">
                  Cancel
                </button>
              ) : (
                total > 0 && (
                  <button type="button" onClick={() => setPeek(true)} className="text-muted underline underline-offset-2 hover:text-ink">
                    See the best times so far
                  </button>
                )
              )}
            </div>
          </form>
        </section>
      ) : (
        <div className="space-y-12">
          <section aria-labelledby="best-times">
            <h2 id="best-times" className="mb-1 text-xl font-bold">
              Best times
            </h2>
            <p className="mb-4 text-muted">{viewerTz && <>Shown in {viewerTz.replace(/_/g, " ")}.</>}</p>
            {viewerTz ? <SlotList slots={view.slots} total={total} tz={viewerTz} /> : <div className="h-40" />}
            {!joined && (
              <button
                type="button"
                onClick={() => setPeek(false)}
                className="mt-6 rounded-lg bg-yolk px-5 py-3 font-bold text-yolk-ink"
              >
                Add your availability
              </button>
            )}
          </section>

          <section aria-labelledby="who">
            <h2 id="who" className="mb-3 text-xl font-bold">
              Who&apos;s in
            </h2>
            <ul className="divide-y divide-line border-y border-line">
              {view.participants.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <span className="font-semibold">{p.name}</span>
                    {p.id === me?.id && <span className="ml-2 text-sm text-muted">(you)</span>}
                  </div>
                  {p.id === me?.id && (
                    <div className="flex shrink-0 gap-3 text-sm">
                      <button type="button" onClick={startEdit} className="underline underline-offset-2">
                        Edit
                      </button>
                      <button type="button" onClick={leave} className="text-muted underline underline-offset-2 hover:text-ink">
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <FormError error={error} />
          </section>
        </div>
      )}
    </div>
  );
}
