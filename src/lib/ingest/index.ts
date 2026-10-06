import type { ParsedAvailability } from "../availability/schema";
import { UserError } from "../errors";
import { NoObjectGeneratedError } from "ai";
import { estimateCost, FALLBACK_MODEL, parseWithLlm } from "./llm";
import { findUrls, readPage } from "./page-reader";

export class IngestError extends UserError {
  constructor(message: string) {
    super(message, 422);
  }
}

export type IngestInput = { text: string; images: string[]; tz: string; now: number; horizonDays: number };

export type IngestHooks = {
  /** Called right before any paid work (page rendering, LLM call). Throw to block it (rate limit, budget). */
  beforeLlm: () => Promise<void>;
  /** Called with the cost of every LLM call, including failed ones. */
  afterLlm: (costUsd: number) => Promise<void>;
};

export async function ingest(input: IngestInput, hooks: IngestHooks): Promise<ParsedAvailability> {
  if (!input.text.trim() && input.images.length === 0) throw new IngestError("Add your availability first.");
  await hooks.beforeLlm();

  // Scheduling links (Calendly, cal.com, zcal, …) are rendered and summarized for the LLM, provider-agnostic.
  const [url] = findUrls(input.text);
  const linked = url ? await readPage(url, input.tz) : undefined;

  const r = await parseWithLlm({ ...input, linked }).catch(async (e) => {
    // Invalid or cut-off structured output isn't a provider error, so gateway fallbacks don't kick in.
    // Retry once with the fallback model; it is pricier but only runs on failure.
    if (!NoObjectGeneratedError.isInstance(e)) throw e;
    if (e.usage) await hooks.afterLlm(estimateCost(e.usage));
    return parseWithLlm({ ...input, linked, model: FALLBACK_MODEL, fallback: false }).catch((e2) => {
      if (NoObjectGeneratedError.isInstance(e2))
        throw new IngestError(
          url
            ? "We couldn't make sense of that link. Paste your slots or a screenshot of it instead."
            : "We couldn't make sense of that. Try rephrasing, like “Tue and Thu 14–17, avoid lunch”.",
        );
      throw e2;
    });
  });
  await hooks.afterLlm(r.costUsd);
  const p = r.parsed;
  if (p.unparseable || (p.free.length === 0 && p.busy.length === 0 && p.bookingStarts.length === 0))
    throw new IngestError(
      url
        ? "We couldn't find open times on that link. Paste your slots or a screenshot instead."
        : "We couldn't find any availability in that. Try something like “Tue and Thu 14–17, avoid lunch”.",
    );
  return p;
}
