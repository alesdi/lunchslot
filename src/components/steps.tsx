export const CREATOR_STEPS = ["Create", "Share", "Your availability", "Best times"];

/** Progress through the meeting flow. Labels of other steps collapse on small screens. */
export function Steps({ steps = CREATOR_STEPS, current }: { steps?: string[]; current: number }) {
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Progress">
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className="h-px w-4 bg-line" />}
            <span
              className={`grid size-6 place-items-center rounded-full text-xs font-bold ${
                state === "current" ? "bg-ink text-paper" : state === "done" ? "bg-line text-ink" : "border border-line text-muted"
              }`}
            >
              {i + 1}
            </span>
            <span className={state === "current" ? "font-semibold" : "hidden text-muted sm:inline"}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
