import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { removeParticipant, replaceAvailability, ReplacementInput } from "@/lib/service";

const Id = z.string().uuid();

export async function PUT(req: Request, ctx: RouteContext<"/api/meetings/[slug]/participants/[id]">) {
  try {
    const { slug, id } = await ctx.params;
    await replaceAvailability(req, slug, Id.parse(id), ReplacementInput.parse(await req.json()));
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
