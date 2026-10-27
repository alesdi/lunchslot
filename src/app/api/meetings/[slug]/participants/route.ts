import { errorResponse } from "@/lib/http";
import { addParticipant, SubmissionInput } from "@/lib/service";

export async function POST(req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants">) {
  try {
    const { slug } = await ctx.params;
    return Response.json(await addParticipant(req, slug, SubmissionInput.parse(await req.json())));
  } catch (e) {
    return errorResponse(e);
  }
}
