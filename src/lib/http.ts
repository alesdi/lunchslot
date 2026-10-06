import { ZodError } from "zod";
import { UserError } from "./errors";

/** Maps known errors to JSON responses with a user-facing message. */
export function errorResponse(e: unknown): Response {
  if (e instanceof ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong reading that. Please try again." }, { status: 500 });
}
