import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">This link doesn&apos;t work</h1>
      <p className="mt-3 text-muted">The meeting doesn&apos;t exist or has expired. Meetings are kept for 60 days after they&apos;re created.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-yolk px-5 py-3 font-bold text-yolk-ink">
        Start a new one
      </Link>
    </div>
  );
}
