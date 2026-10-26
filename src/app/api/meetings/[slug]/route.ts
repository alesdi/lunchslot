import { toHorizonDays } from "@/lib/horizon";
import { errorResponse } from "@/lib/http";
import { getMeetingView } from "@/lib/service";

export async function GET(req: Request, ctx: RouteContext<"/api/meetings/[slug]">) {
  try {
    const { slug } = await ctx.params;
    const days = toHorizonDays(new URL(req.url).searchParams.get("days"));
    return Response.json(await getMeetingView(slug, days), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
