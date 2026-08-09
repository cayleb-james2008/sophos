// nextDue — honest next-run estimate for heartbeat/schedule intervals (A2c).
//
// Research D34: heartbeats that coincide with a busy session are dropped, not
// deferred, with no run counter or skip notice. The contract's HeartbeatInfo /
// ScheduleInfo carry only { id, interval, active } — no last-fired or next-due
// timestamp. So we cannot show real last-fired/next-due from the daemon.
//
// Instead we compute a best-effort *estimate* of the next run from the interval
// string for the common forms we can parse, and label it "(est.)". Anything we
// cannot parse returns null and the UI shows "—" rather than inventing a value.
// Last-fired is honestly reported as "not reported by daemon".

function minutesFromNow(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

function fmt(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `in ~${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `in ~${diffH} h`;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Parse a cron minute field like star-slash-15 or 0 or 5. */
function parseMinuteField(field: string): number | null {
  const m = /^\*\/(\d+)$/.exec(field.trim());
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * Estimate the next run time for a heartbeat/schedule interval. Returns a
 * human string like "in ~15 min" or null when the interval can't be parsed.
 */
export function estimateNextDue(interval: string): string | null {
  const s = (interval ?? "").trim().toLowerCase();
  if (!s) return null;

  // Cron form: "*/N * * * *" → every N minutes.
  const cron = s.split(/\s+/);
  if (cron.length >= 5) {
    const minField = parseMinuteField(cron[0]);
    if (minField != null) {
      // "0 * * * *" → hourly; "*/N * * * *" → every N minutes.
      if (cron[0].trim() === "0") return fmt(minutesFromNow(60));
      return fmt(minutesFromNow(minField));
    }
    // "0 9 * * *" → daily at 09:00.
    const hour = /^(\d{1,2})$/.exec(cron[0].trim());
    const hourField = /^(\d{1,2})$/.exec(cron[1].trim());
    if (hour && hour[0] === "0" && hourField) {
      const h = parseInt(hourField[1], 10);
      if (h >= 0 && h <= 23) {
        const next = new Date();
        next.setHours(h, 0, 0, 0);
        if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
        return fmt(next);
      }
    }
    return null;
  }

  // Human forms: "every 10m", "every 5 minutes", "10m", "2h", "every 2 hours".
  const everyMin = /every\s+(\d+)\s*(m|min|mins|minutes?)/.exec(s);
  if (everyMin) return fmt(minutesFromNow(parseInt(everyMin[1], 10)));
  const everyHour = /every\s+(\d+)\s*(h|hr|hrs|hours?)/.exec(s);
  if (everyHour) return fmt(minutesFromNow(parseInt(everyHour[1], 10) * 60));
  const bareMin = /^(\d+)\s*(m|min|mins?)$/.exec(s);
  if (bareMin) return fmt(minutesFromNow(parseInt(bareMin[1], 10)));
  const bareHour = /^(\d+)\s*(h|hr|hrs?)$/.exec(s);
  if (bareHour) return fmt(minutesFromNow(parseInt(bareHour[1], 10) * 60));

  return null;
}
