import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, calendarEnabled, STATE_COOKIE } from "@/lib/google-calendar";

// Opened in a popup by the availability form: sends the person to Google's consent screen.
export async function GET(req: Request) {
  if (!calendarEnabled()) return new Response("Google Calendar isn't set up.", { status: 404 });
  const { origin, protocol } = new URL(req.url);
  const state = randomBytes(18).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: protocol === "https:",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(origin, state), 302);
}
