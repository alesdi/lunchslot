"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { copyText } from "@/lib/client";

const noop = () => () => {};

export function ShareCard({ slug, title }: { slug: string; title: string }) {
  const origin = useSyncExternalStore(noop, () => location.origin, () => "");
  const canShare = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);
  const url = `${origin}/m/${slug}`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor="share-url" className="mb-2 block font-semibold">
          Meeting link
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="share-url"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-3 text-lg font-semibold outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-ink px-5 py-3 font-bold text-paper"
          >
            {copied ? "Link copied" : "Copy link"}
          </button>
          {canShare && (
            <button
              type="button"
              onClick={() => navigator.share({ title, url }).catch(() => {})}
              className="rounded-lg border border-ink px-5 py-3 font-semibold"
            >
              Share
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">
          Anyone with the link can add their availability. The best times update as people reply.
        </p>
      </div>
      <Link href={`/m/${slug}`} className="inline-block rounded-lg bg-yolk px-5 py-3 font-bold text-yolk-ink">
        Next: add your availability
      </Link>
    </div>
  );
}
