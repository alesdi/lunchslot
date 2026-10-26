import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { SubmissionInput, upsertParticipant } from "@/lib/service";

const Owner = z.object({ participantId: z.string().uuid(), editToken: z.string().min(10).max(100) });

export async function POST(req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants">) {
  try {
    const { slug } = await ctx.params;
    const input = SubmissionInput.extend(Owner.partial().shape).parse(await req.json());
    return Response.json(await upsertParticipant(req, slug, input));
  } catch (e) {
    return errorResponse(e);
  }
}
