// Tool arguments are wall-clock times at the practice. Adapters use instants.
export function practiceTime(date: string, time: string, timeZone: string): number {
  const wallClock = `${date}T${time}`;
  const asUtc = Date.parse(`${wallClock}:00Z`);
  if (!Number.isFinite(asUtc) || new Date(asUtc).toISOString().slice(0, 16) !== wallClock) {
    return NaN;
  }

  const formatter = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" });
  function offsetAt(instant: number): number {
    const offset = formatter.formatToParts(instant).find(({ type }) => type === "timeZoneName")?.value;
    const parts = offset?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!parts) return 0;
    const [, sign, hours, minutes] = parts;
    return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
  }

  const firstGuess = asUtc - offsetAt(asUtc);
  const instant = asUtc - offsetAt(firstGuess);
  // An hour skipped by a daylight-saving transition has no matching instant.
  return instant + offsetAt(instant) === asUtc ? instant : NaN;
}

export function practiceDay(date: string, timeZone: string): [number, number] {
  const utcDate = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(utcDate)) return [NaN, NaN];
  const nextDate = new Date(utcDate + 86_400_000).toISOString().slice(0, 10);
  return [practiceTime(date, "00:00", timeZone), practiceTime(nextDate, "00:00", timeZone)];
}
