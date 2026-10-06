import { errorResponse } from "@/lib/http";
import { getMeetingView } from "@/lib/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/meetings/[slug]">) {
  try {
    const { slug } = await ctx.params;
    return Response.json(await getMeetingView(slug), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
