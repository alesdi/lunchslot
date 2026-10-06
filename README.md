# Lunchslot

Find a meeting time that works for everyone, without accounts or calendar access.

1. **Create**: pick a length (30 min by default) and, optionally, a title. Recent meetings you've created are offered as presets.
2. **Share**: copy the link and send it to everyone.
3. **Your availability**: everyone, including you, writes their availability however they like ("Tue and Thu after 2pm, avoid lunch"), pastes a scheduling link (Calendly, cal.com, zcal…), or drops a calendar screenshot. The time zone is prefilled from the browser and can be changed.
4. **Best times**: the page shows the 3 best times for the group and updates as people reply.

Free to use and MIT licensed.

## How it works

- **The LLM only parses.** Each submission makes one call through [Vercel AI Gateway](https://vercel.com/ai-gateway), which turns the input into structured data: free ranges, busy ranges, booking-page slot starts, and soft preferences, all in local time (`src/lib/ingest/llm.ts`, schema in `src/lib/availability/schema.ts`).
- **Matching is plain code.** `src/lib/match.ts` turns each person's data into UTC intervals, timezone- and DST-aware via `@date-fns/tz`. It intersects them on a 15-minute grid, scores candidates against everyone's preferences, and picks up to 3 slots, spread across different days where possible. If no time fits everyone, it shows the slots that fit the most people and says who is missing. Page views never cost an LLM call.
- **Scheduling links are read without provider-specific code** (`src/lib/ingest/page-reader.ts`). The page is rendered in headless Chromium in the participant's time zone. The reader keeps the visible text plus any JSON the page loads that contains timestamps, which is where booking tools keep their slots. In code, it converts timestamps to local time, drops empty values, and compresses runs of evenly spaced start times ("starts every 30 min from 2026-10-07 09:00 through 11:30"). A month of Calendly or cal.com slots then costs about 1k tokens, and the model only copies runs. Only public http(s) hosts are allowed, and private IPs are blocked. Use `pnpm tsx scripts/probe-link.ts <url>` to see exactly what the LLM would receive (no LLM call).
- **Screenshots** are downscaled in the browser, sent once, and never stored.

## Cost and abuse controls

- Global daily LLM budget (`DAILY_LLM_BUDGET_USD`, default $2). Each call's real cost comes from the gateway response metadata and is added to the `llm_spend` table. Once the budget is used up, parsing pauses until the next UTC day.
- Per-IP rate limits (salted hash, never the raw IP) for parses and meeting creation, stored in Postgres. Rate limits and the budget are checked before a link is rendered or the LLM is called.
- Input caps: 4,000 characters, 2 images, 1 link (rendered with a 15 s limit, digest capped at 40k characters), 20 people per meeting, 1,500 output tokens (3,000 with a link), and a 20 s LLM timeout.
- Recommended backstop: set a spend limit on AI Gateway in the Vercel dashboard as well.

## Model choice

`pnpm eval` runs `scripts/eval-models.ts`, which checks models against fixtures with known answers: English and Italian text, relative dates, "next week", busy exceptions, a stated timezone, a Google Calendar week screenshot, a booking-page screenshot, saved Calendly and cal.com page digests, and a prompt injection. A full run with the default model costs under $0.01. Use `ONLY=link,busy` to run a subset.

Latest results for the default, `google/gemini-2.5-flash-lite`: 50/52 checks on the full run. The failing case passed when re-run, so the model is slightly nondeterministic even at temperature 0. Average time is about 2 s, and cost is about $0.0003–0.001 per parse. Earlier comparisons:

| Model | Accuracy | Avg latency | Cost / 1k parses |
|---|---|---|---|
| `openai/gpt-4.1-mini` (fallback) | 38/38 | ~5.5 s | ~$0.97 |
| `google/gemini-2.5-flash` | 34/34* | ~4 s | ~$2.00 |
| `openai/gpt-5-nano` (minimal reasoning) | 27/38 | ~3.2 s | ~$0.16 |
| `mistral/mistral-small` | flaky structured output | ~1.4 s | ~$0.19 |

\* measured on an earlier, smaller fixture set; link fixtures were added later.

## Development

```bash
pnpm install
vercel link && vercel env pull .env.local   # DATABASE_URL + VERCEL_OIDC_TOKEN for AI Gateway
pnpm db:migrate
pnpm dev
```

- `pnpm test`: matching engine unit tests
- `pnpm eval [model...]`: model comparison (append `@none` / `@low` to set the reasoning level)
- `pnpm db:generate`: create a migration after changing `src/db/schema.ts`

## CI and deployment

- GitHub Actions (`.github/workflows/ci.yml`) runs lint, type checks and unit tests on every push and PR. It makes no LLM calls and needs no secrets.
- Vercel's Git integration builds a preview for every PR and deploys `main` to production.
- Model evals spend AI Gateway credits, so they are never run automatically. Run `pnpm eval` by hand (under $0.01 per full run).

Stack: Next.js (App Router) on Vercel, AI SDK + AI Gateway, Neon Postgres via Drizzle, Tailwind CSS.
