import { errorResponse } from "@/lib/http";
import { getMeetingView } from "@/lib/service";
import { toViewOptions } from "@/lib/view-options";

export async function GET(req: Request, ctx: RouteContext<"/api/meetings/[slug]">) {
  try {
    const { slug } = await ctx.params;
    const q = new URL(req.url).searchParams;
    return Response.json(await getMeetingView(slug, toViewOptions(q.get("days"), q.get("required"))), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
