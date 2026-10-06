"use client";

import { useMemo, useSyncExternalStore } from "react";

export type Ownership = { participantId: string; editToken: string };

const ownerKey = (slug: string) => `lunchslot:${slug}`;
const NAME_KEY = "lunchslot:name";
const TZ_KEY = "lunchslot:tz";
const RECENT_KEY = "lunchslot:recent";

export type RecentMeeting = { slug: string; title: string; durationMin: number };

// localStorage as a tiny external store, so components read it without hydration mismatches.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  listeners.forEach((l) => l());
}

export const storage = {
  setOwner: (slug: string, o: Ownership) => write(ownerKey(slug), JSON.stringify(o)),
  clearOwner: (slug: string) => write(ownerKey(slug), null),
  setName: (name: string) => write(NAME_KEY, name),
  setTz: (tz: string) => write(TZ_KEY, tz),
  addRecent(m: RecentMeeting) {
    const list = parseRecent(read(RECENT_KEY)).filter((r) => r.slug !== m.slug);
    write(RECENT_KEY, JSON.stringify([m, ...list].slice(0, 20)));
  },
};

function parseRecent(raw: string | null): RecentMeeting[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Meetings this browser created, newest first. */
export function useRecentMeetings(): RecentMeeting[] {
  const raw = useSyncExternalStore(subscribe, () => read(RECENT_KEY), () => null);
  return useMemo(() => parseRecent(raw), [raw]);
}

export function useOwner(slug: string): Ownership | null {
  const raw = useSyncExternalStore(subscribe, () => read(ownerKey(slug)), () => null);
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Ownership) : null;
    } catch {
      return null;
    }
  }, [raw]);
}

export function useStoredName(): string {
  return useSyncExternalStore(subscribe, () => read(NAME_KEY) ?? "", () => "");
}

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The timezone to show times in: the one the viewer last picked, else the browser's. Null on the server. */
export function useViewerTz(): string | null {
  return useSyncExternalStore(subscribe, () => read(TZ_KEY) || browserTz(), () => null);
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Downscale an image file to a JPEG data URL that comfortably fits in a request. */
export async function resizeImage(file: File, maxSide = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
