"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ParticipantSource } from "@/db/schema";
import { timeAgo } from "@/lib/format";
import { HORIZONS, horizonPhrase } from "@/lib/horizon";
import type { MeetingView } from "@/lib/service";
import type { ViewOptions } from "@/lib/view-options";
import {
  copyText,
  isValidTz,
  postJson,
  storage,
  useNow,
  useOwnedEntries,
  useRecentMeetings,
  useStoredName,
  useViewerTz,
  type OwnedEntry,
  type Ownership,
} from "@/lib/client";
import { AvailabilityInput } from "./availability-input";
import { FormError, NameField, SubmitButton } from "./form-bits";
import { MeetingHeading } from "./meeting-title";
import { SlotList, SlotListSkeleton } from "./slot-list";
import { CREATOR_STEPS, Steps } from "./steps";
import { TimezoneField } from "./timezone-field";

const POLL_MS = 5000;
const INVITEE_STEPS = ["Your availability", "Best times"];
const SOURCE_LABELS: Record<ParticipantSource, string> = { link: "Calendar link", screenshot: "Screenshot", text: "Written" };

type Participant = MeetingView["participants"][number];

export function MeetingClient({ initial }: { initial: MeetingView }) {
  const slug = initial.slug;
  const [view, setView] = useState(initial);
  const viewerTz = useViewerTz();
  const now = useNow();
  // Entries this browser can edit: the viewer's own, plus any they added for people without the link.
  const owned = useOwnedEntries(slug);
  const isCreator = useRecentMeetings().some((m) => m.slug === slug);
  const [editing, setEditing] = useState<OwnedEntry | null>(null);
  // Adding a new entry for someone else, who then never needs the link.
  const [adding, setAdding] = useState(false);
  // Someone else whose availability is being replaced. Their current entry is never shown, only overwritten.
  const [replacing, setReplacing] = useState<Participant | null>(null);
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
  const [refreshState, setRefreshState] = useState<"idle" | "busy" | "done">("idle");
  // How the viewer looks at the best times. Mirrored in a ref, so a response to a request made before
  // the last change (a poll for the previous range, say) is dropped instead of shown.
  const [viewOpts, setViewOptsState] = useState<ViewOptions>({ horizonDays: initial.horizonDays, required: initial.required });
  const viewOptsRef = useRef({ ...viewOpts, version: 0 });
  // True while the slots are recomputed after the viewer changed what they're looking at.
  const [switching, setSwitching] = useState(false);
  const horizonId = useId();

  /** Runs a request for the current view options, and shows its view only if they haven't changed since. */
  const loadView = useCallback(async (request: (o: ViewOptions) => Promise<MeetingView | null>) => {
    const { version, ...opts } = viewOptsRef.current;
    const v = await request(opts);
    if (v && viewOptsRef.current.version === version) setView(v);
  }, []);

  const refresh = useCallback(
    () =>
      loadView(async ({ horizonDays, required }) => {
        const res = await fetch(`/api/meetings/${slug}?days=${horizonDays}&required=${required.join(",")}`, { cache: "no-store" });
        return res.ok ? res.json() : null;
      }),
    [slug, loadView],
  );

  function setViewOpts(next: ViewOptions) {
    const version = viewOptsRef.current.version + 1;
    viewOptsRef.current = { ...next, version };
    setViewOptsState(next);
    setSwitching(true);
    // Shown for a moment even when the answer is instant, so it's clear the times were recomputed.
    Promise.all([refresh(), new Promise((r) => setTimeout(r, 400))])
      .catch(() => {})
      .finally(() => viewOptsRef.current.version === version && setSwitching(false));
  }

  function toggleRequired(id: string) {
    const { required } = viewOpts;
    setViewOpts({ ...viewOpts, required: required.includes(id) ? required.filter((r) => r !== id) : [...required, id] });
  }

  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && refresh();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const ownedEntry = (p: Participant) => owned.find((o) => o.participantId === p.id);
  const me = view.participants.find((p) => ownedEntry(p) && !ownedEntry(p)?.other);
  const joined = !!me;
  const showForm = (!joined && !peek) || !!editing || !!replacing || adding;
  // Whether the form is about someone other than the viewer.
  const forOther = adding || !!editing?.other;
  const editingName = editing && view.participants.find((p) => p.id === editing.participantId)?.name;
  const total = view.participants.length;
  const idle = view.participants.filter((p) => !p.hasTimes).map((p) => p.name);
  const requiredNames = view.participants.filter((p) => view.required.includes(p.id)).map((p) => p.name);

  async function copyLink() {
    if (await copyText(`${location.origin}/m/${slug}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  // The server decides whether links are actually re-read (at most daily); either way we show the latest view.
  async function refreshLinks() {
    setError(null);
    setRefreshState("busy");
    try {
      await loadView(({ horizonDays, required }) =>
        postJson<MeetingView>(`/api/meetings/${slug}/refresh`, { days: horizonDays, required }),
      );
      setRefreshState("done");
      setTimeout(() => setRefreshState("idle"), 2500);
    } catch (e) {
      setError((e as Error).message);
      setRefreshState("idle");
    }
  }

  async function startEdit(o: OwnedEntry) {
    setError(null);
    try {
      const { participantId, editToken } = o;
      const entry = await postJson<{ name: string; tz: string; text: string }>(`/api/meetings/${slug}/me`, { participantId, editToken });
      setName(entry.name);
      setTz(entry.tz);
      setText(entry.text);
      setImages([]);
      setEditing(o);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function leave(o: OwnedEntry) {
    await postJson(`/api/meetings/${slug}/participants/${o.participantId}`, {}, "DELETE").catch(() => {});
    storage.forgetEntry(slug, o.participantId);
    setText("");
    refresh();
  }

  function startAdd() {
    setError(null);
    setName("");
    setTz(null);
    setText("");
    setImages([]);
    setAdding(true);
  }

  async function removeOther(p: Participant) {
    if (!confirm(`Remove ${p.name} from this meeting? Their availability will be deleted.`)) return;
    setError(null);
    try {
      await postJson(`/api/meetings/${slug}/participants/${p.id}`, {}, "DELETE");
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  }

  function startReplace(p: Participant) {
    setError(null);
    setTz(p.tz);
    setText("");
    setImages([]);
    setReplacing(p);
  }

  function closeForm() {
    setName(null);
    setTz(null);
    setReplacing(null);
    setEditing(null);
    setAdding(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (replacing) {
        await postJson(`/api/meetings/${slug}/participants/${replacing.id}`, { tz, text, images }, "PUT");
        closeForm();
        setText("");
        setImages([]);
        await refresh();
        return;
      }
      const res = await postJson<Ownership>(`/api/meetings/${slug}/participants`, {
        name,
        tz,
        text,
        images,
        ...(editing ? { participantId: editing.participantId, editToken: editing.editToken } : {}),
      });
      storage.saveEntry(slug, forOther ? { ...res, other: true } : res);
      // Someone else's name and timezone aren't the viewer's defaults.
      if (!forOther) {
        storage.setName(name);
        storage.setTz(tz);
      }
      closeForm();
      // Back to the best times, even if the viewer hasn't added themselves yet.
      setPeek(forOther);
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
  const othersIn = view.participants.filter((p) => p.id !== (editing?.participantId ?? me?.id)).map((p) => p.name);
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
            {replacing
              ? `Replace ${replacing.name}'s availability`
              : adding
                ? "Add someone else"
                : editing?.other
                  ? editingName
                    ? `Edit ${editingName}'s availability`
                    : "Edit their availability"
                  : editing
                    ? "Edit your availability"
                    : "When are you free?"}
          </h2>
          {replacing ? (
            // Loud on purpose: Replace sits right next to Remove, so this may well be a misclick.
            <div role="alert" className="mt-4 mb-6 rounded-lg border-2 border-warn bg-surface px-4 py-3">
              <p className="font-bold text-warn">You&apos;re editing {replacing.name}&apos;s availability, not yours.</p>
              <p className="mt-1 text-muted">
                Whatever you add here replaces what {replacing.name} entered. Their current times stay private.{" "}
                <button type="button" onClick={closeForm} className="text-ink underline underline-offset-2">
                  Not what you meant? Go back
                </button>
              </p>
            </div>
          ) : adding ? (
            <p className="mb-6 text-muted">
              For someone who won&apos;t open the link themselves. Their entry stays editable from this browser.
            </p>
          ) : (
            <p className="mb-6 text-muted">
              {othersIn.length > 0
                ? `${othersIn.join(", ")} ${othersIn.length === 1 ? "has" : "have"} already replied.`
                : "You're the first. Others will see the best times once they add theirs."}
            </p>
          )}
          <form onSubmit={submit} className="space-y-6">
            <div className="flex flex-col gap-6 sm:flex-row">
              {!replacing && <NameField value={name} onChange={setName} disabled={busy} label={forOther ? "Their name" : undefined} />}
              <TimezoneField value={tz} onChange={setTz} disabled={busy} />
            </div>
            <AvailabilityInput text={text} onText={setText} images={images} onImages={setImages} disabled={busy} />
            <FormError error={error} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <SubmitButton
                busy={busy}
                busyLabel={hasLink ? "Opening your link…" : "Reading your availability…"}
                disabled={(!replacing && !name.trim()) || !isValidTz(tz) || (!text.trim() && !images.length)}
              >
                {replacing
                  ? `Replace ${replacing.name}'s availability`
                  : editing
                    ? "Save changes"
                    : adding
                      ? name.trim()
                        ? `Add ${name.trim()}'s availability`
                        : "Add their availability"
                      : "Add my availability"}
              </SubmitButton>
              {editing || replacing || adding ? (
                <button type="button" onClick={closeForm} className="text-muted underline underline-offset-2">
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
            <div className="mb-1 flex items-baseline justify-between gap-4">
              <h2 id="best-times" className="text-xl font-bold">
                Best times
              </h2>
              <button
                type="button"
                onClick={refreshLinks}
                disabled={refreshState === "busy"}
                className="text-sm text-muted underline underline-offset-2 hover:text-ink disabled:no-underline"
              >
                {refreshState === "busy" ? "Refreshing…" : refreshState === "done" ? "Up to date" : "Refresh"}
              </button>
            </div>
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-muted">
              <label htmlFor={horizonId} className="sr-only">
                How far ahead to look
              </label>
              <select
                id={horizonId}
                value={viewOpts.horizonDays}
                onChange={(e) => setViewOpts({ ...viewOpts, horizonDays: Number(e.target.value) })}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 font-semibold text-ink outline-none focus:border-ink"
              >
                {HORIZONS.map((h) => (
                  <option key={h.days} value={h.days}>
                    {h.label}
                  </option>
                ))}
              </select>
              {viewerTz && <span>Shown in {viewerTz.replace(/_/g, " ")}.</span>}
            </div>
            {total > 1 && (
              <fieldset className="mb-5">
                <legend className="mb-2 text-sm text-muted">
                  <span className="font-semibold text-ink">Must attend</span>: only show times they can all make
                </legend>
                <div className="flex flex-wrap gap-2">
                  {view.participants.map((p) => {
                    const on = viewOpts.required.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleRequired(p.id)}
                        className={`rounded-full px-3 py-1 text-sm font-semibold ${
                          on ? "bg-ink text-paper" : "border border-line text-muted hover:border-ink hover:text-ink"
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {viewerTz && switching ? (
              <SlotListSkeleton count={view.slots.length} />
            ) : viewerTz ? (
              <SlotList
                slots={view.slots}
                total={total - idle.length}
                idle={idle}
                required={requiredNames}
                tz={viewerTz}
                range={horizonPhrase(view.horizonDays)}
              />
            ) : (
              <div className="h-40" />
            )}
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
              {view.participants.map((p) => {
                const own = ownedEntry(p);
                return (
                  <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <span className="font-semibold">{p.name}</span>
                      {own && <span className="ml-2 text-sm text-muted">{own.other ? "(added by you)" : "(you)"}</span>}
                      <div className="text-sm text-muted">
                        {SOURCE_LABELS[p.source]}
                        {now !== null && <>, updated {timeAgo(p.updatedAt, now)}</>}
                        {!p.hasTimes && <span className="text-warn">. No times in the {horizonPhrase(view.horizonDays)}</span>}
                      </div>
                    </div>
                    {own ? (
                      <div className="flex shrink-0 gap-3 text-sm">
                        <button type="button" onClick={() => startEdit(own)} className="underline underline-offset-2">
                          Edit
                        </button>
                        <button type="button" onClick={() => leave(own)} className="text-muted underline underline-offset-2 hover:text-ink">
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 gap-3 text-sm">
                        <button type="button" onClick={() => startReplace(p)} className="underline underline-offset-2">
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOther(p)}
                          className="text-muted underline underline-offset-2 hover:text-ink"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={startAdd}
              className="mt-4 rounded-lg border border-ink px-4 py-2 font-semibold hover:bg-ink hover:text-paper"
            >
              Add someone else
            </button>
            <FormError error={error} />
          </section>
        </div>
      )}
    </div>
  );
}
