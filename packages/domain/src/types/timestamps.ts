export type UtcInstant = string;

export function toUtcInstant(date: Date): UtcInstant {
  return date.toISOString();
}

export function parseUtcInstant(value: UtcInstant): Date {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid UTC instant: ${value}`);
  }
  return new Date(parsed);
}

export function addMilliseconds(instant: UtcInstant, ms: number): UtcInstant {
  return toUtcInstant(new Date(parseUtcInstant(instant).getTime() + ms));
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
