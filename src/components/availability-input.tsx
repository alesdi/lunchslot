"use client";

import { useId, useRef, useState } from "react";
import { resizeImage } from "@/lib/client";

const MAX_IMAGES = 2;

export function AvailabilityInput({
  text,
  onText,
  images,
  onImages,
  disabled,
}: {
  text: string;
  onText: (t: string) => void;
  images: string[];
  onImages: (imgs: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  async function addFiles(files: Iterable<File>) {
    setImageError(null);
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return setImageError(`Up to ${MAX_IMAGES} screenshots.`);
    try {
      const resized = await Promise.all(imgs.slice(0, room).map((f) => resizeImage(f)));
      onImages([...images, ...resized]);
    } catch {
      setImageError("That image couldn't be read. Try a PNG or JPEG screenshot.");
    }
  }

  return (
    <div>
      <label htmlFor={id} className="mb-2 block font-semibold">
        Your availability
      </label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={`rounded-lg border bg-surface transition-colors ${dragging ? "border-ink border-dashed" : "border-line"} focus-within:border-ink`}
      >
        <textarea
          id={id}
          value={text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          rows={5}
          maxLength={4000}
          placeholder={"Tue and Thu after 2pm, Friday morning. Please avoid lunch.\n\nOr paste a scheduling link (Calendly, cal.com, zcal…), or drop a screenshot of your calendar."}
          className="block w-full resize-y rounded-t-lg bg-transparent px-4 py-3 leading-relaxed outline-none placeholder:text-muted/80"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          {images.map((src, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Screenshot ${i + 1}`} className="h-12 w-16 rounded border border-line object-cover" />
              <button
                type="button"
                onClick={() => onImages(images.filter((_, j) => j !== i))}
                className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-ink text-xs text-paper"
                aria-label={`Remove screenshot ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
              className="rounded px-2 py-1 text-sm text-muted hover:text-ink"
            >
              Add a calendar screenshot
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {imageError && <p className="mt-2 text-sm text-warn">{imageError}</p>}
    </div>
  );
}
