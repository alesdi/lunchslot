ALTER TABLE "meetings" ADD COLUMN "refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "source" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
-- Backfill: images aren't stored, so an entry with no text must have come from a screenshot.
UPDATE "participants" SET "source" = CASE WHEN "raw_text" ~* 'https?://' THEN 'link' WHEN btrim("raw_text") = '' THEN 'screenshot' ELSE 'text' END;
