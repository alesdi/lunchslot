// Renders a link the way the app does and prints the digest the LLM would see. No LLM calls.
// Usage: pnpm tsx scripts/probe-link.ts <url> [timezone]
import { readPage } from "../src/lib/ingest/page-reader";

const [url, tz = "Europe/Rome"] = process.argv.slice(2);
const t0 = Date.now();
const digest = await readPage(url, tz);
console.log(`${digest.length} chars (~${Math.round(digest.length / 4)} tokens) in ${Date.now() - t0}ms\n`);
console.log(process.env.FULL ? digest : digest.slice(0, 2500));
