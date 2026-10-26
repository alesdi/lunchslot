import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { exchangeCode, sealGrant, STATE_COOKIE, type CalendarMessage } from "@/lib/google-calendar";
import { UserError } from "@/lib/errors";

// Google sends the popup here. Exchange the code right away (codes are short-lived) and hand the form an
// encrypted grant, which it submits with the rest of the availability.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value ?? "";
  jar.delete({ name: STATE_COOKIE, path: "/api/google" });

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  let msg: CalendarMessage;
  if (!expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    msg = { type: "lunchslot:calendar", error: "That Google sign-in didn't start here. Try connecting again." };
  } else if (!code) {
    // access_denied when the person cancels on the consent screen.
    msg = { type: "lunchslot:calendar", error: url.searchParams.get("error") === "access_denied" ? undefined : "Google sign-in failed. Try again." };
  } else {
    try {
      msg = { type: "lunchslot:calendar", grant: sealGrant(await exchangeCode(code, url.origin)) };
    } catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      msg = { type: "lunchslot:calendar", error: e instanceof UserError ? e.message : "Google sign-in failed. Try again." };
    }
  }
  return new Response(popupPage(msg, url.origin), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

// Posts the result to the form that opened the popup (same origin only) and closes.
function popupPage(msg: CalendarMessage, origin: string) {
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset="utf-8"><title>Lunchslot</title>
<p style="font-family:system-ui;margin:2rem">You can close this window.</p>
<script>if (window.opener) window.opener.postMessage(${json(msg)}, ${json(origin)}); window.close();</script>`;
}
