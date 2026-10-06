import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeetingHeading } from "@/components/meeting-title";
import { meetingTitle } from "@/lib/format";
import { ShareCard } from "@/components/share-card";
import { Steps } from "@/components/steps";
import { UserError } from "@/lib/errors";
import { getMeetingView } from "@/lib/service";

export const metadata: Metadata = { title: "Share your meeting — Lunchslot" };

export default async function SharePage({ params }: PageProps<"/m/[slug]/share">) {
  const { slug } = await params;
  const view = await getMeetingView(slug).catch((e) => {
    if (e instanceof UserError && e.status === 404) notFound();
    throw e;
  });
  return (
    <>
      <Steps current={1} />
      <div className="mb-8">
        <MeetingHeading m={view} />
      </div>
      <ShareCard slug={slug} title={meetingTitle(view)} />
    </>
  );
}
