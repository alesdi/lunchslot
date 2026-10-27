import { DEFAULT_HORIZON_DAYS, toHorizonDays } from "./horizon";

/** How a viewer looks at the best times. Chosen per viewer on the results screen, never saved. */
export type ViewOptions = {
  horizonDays: number;
  /** Participant ids that must be able to make every suggested time. */
  required: string[];
};

export const DEFAULT_VIEW: ViewOptions = { horizonDays: DEFAULT_HORIZON_DAYS, required: [] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** From query params or a JSON body. `required` is a list of ids, or one comma-separated string. */
export function toViewOptions(days: unknown, required: unknown): ViewOptions {
  const ids = Array.isArray(required) ? required : typeof required === "string" ? required.split(",") : [];
  return {
    horizonDays: toHorizonDays(days),
    required: [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 20),
  };
}
