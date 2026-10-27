import { errorResponse } from "@/lib/http";
import { refreshMeeting } from "@/lib/service";
import { toViewOptions } from "@/lib/view-options";

// Re-reading several calendar links (headless Chromium + LLM each) can take a while.
export const maxDuration = 300;

export async function POST(req: Request, ctx: RouteContext<"/api/meetings/[slug]/refresh">) {
  try {
    const { slug } = await ctx.params;
    const { days, required } = await req.json().catch(() => ({}));
    return Response.json(await refreshMeeting(slug, toViewOptions(days, required)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
