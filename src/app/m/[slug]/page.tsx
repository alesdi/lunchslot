import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MeetingClient } from "@/components/meeting-client";
import { meetingTitle } from "@/lib/format";
import { UserError } from "@/lib/errors";
import { getMeetingView } from "@/lib/service";

const load = cache((slug: string) =>
  getMeetingView(slug).catch((e) => {
    if (e instanceof UserError && e.status === 404) notFound();
    throw e;
  }),
);

export async function generateMetadata({ params }: PageProps<"/m/[slug]">): Promise<Metadata> {
  const view = await load((await params).slug);
  return {
    title: `${meetingTitle(view)} — Lunchslot`,
    description: "Add your availability and see the times that work for everyone.",
  };
}

export default async function MeetingPage({ params }: PageProps<"/m/[slug]">) {
  const view = await load((await params).slug);
  return <MeetingClient initial={view} />;
}
