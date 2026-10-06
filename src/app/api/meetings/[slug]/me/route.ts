import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { getOwnEntry } from "@/lib/service";

const Owner = z.object({ participantId: z.string().uuid(), editToken: z.string().min(10).max(100) });

// POST so the edit token stays out of URLs and logs.
export async function POST(req: Request, ctx: RouteContext<"/api/meetings/[slug]/me">) {
  try {
    const { slug } = await ctx.params;
    const { participantId, editToken } = Owner.parse(await req.json());
    return Response.json(await getOwnEntry(slug, participantId, editToken));
  } catch (e) {
    return errorResponse(e);
  }
}
