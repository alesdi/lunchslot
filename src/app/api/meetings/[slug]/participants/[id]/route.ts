import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { getEntry, removeParticipant, SubmissionInput, updateParticipant } from "@/lib/service";

const Id = z.string().uuid();

export async function GET(_req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants/[id]">) {
  try {
    const { slug, id } = await ctx.params;
    return Response.json(await getEntry(slug, Id.parse(id)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants/[id]">) {
  try {
    const { slug, id } = await ctx.params;
    await updateParticipant(req, slug, Id.parse(id), SubmissionInput.parse(await req.json()));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants/[id]">) {
  try {
    const { slug, id } = await ctx.params;
    await removeParticipant(slug, Id.parse(id));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
