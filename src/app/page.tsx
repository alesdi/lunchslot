import { CreateForm } from "@/components/create-form";
import { Steps } from "@/components/steps";

export default function Home() {
  return (
    <>
      <Steps current={0} />
      <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
        Find a time that works for everyone.
      </h1>
      <p className="mt-4 mb-10 max-w-[34rem] text-lg text-muted">
        Create a meeting and share the link. Everyone drops their availability however they like, as text, a
        scheduling link, or a calendar screenshot, and Lunchslot suggests the times that work for the group.
      </p>
      <CreateForm />
    </>
  );
}
