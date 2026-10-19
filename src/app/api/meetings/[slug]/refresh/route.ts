import { errorResponse } from "@/lib/http";
import { refreshMeeting } from "@/lib/service";

// Re-reading several calendar links (headless Chromium + LLM each) can take a while.
export const maxDuration = 300;

export async function POST(_req: Request, ctx: RouteContext<"/api/meetings/[slug]/refresh">) {
  try {
    const { slug } = await ctx.params;
    return Response.json(await refreshMeeting(slug), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
