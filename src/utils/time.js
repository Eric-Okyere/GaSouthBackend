const TZ = 'Africa/Accra';

/** 'YYYY-MM-DD' for a Date, in the district's timezone. */
function dateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/** Start/end of a given 'YYYY-MM-DD' day in Africa/Accra, as UTC Date bounds.
 *  Accra is UTC+0 with no DST, so this is a plain calendar-day range — kept
 *  as a named helper so the timezone assumption lives in one place. */
function dayBounds(dateString) {
  const start = new Date(dateString + 'T00:00:00.000Z');
  const end = new Date(dateString + 'T23:59:59.999Z');
  return { start, end };
}

function isWeekend(dateString) {
  const day = new Date(dateString + 'T00:00:00.000Z').getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

/** Every 'YYYY-MM-DD' from start to end (inclusive), for present/absent
 *  counting. Weekends are dropped by default — schools aren't normally in
 *  session then, so an unmarked Saturday shouldn't count as an absence. */
function daysBetween(startStr, endStr, { excludeWeekends = true } = {}) {
  const out = [];
  let cur = new Date(startStr + 'T00:00:00.000Z');
  const endD = new Date(endStr + 'T00:00:00.000Z');
  while (cur.getTime() <= endD.getTime()) {
    const s = dateStr(cur);
    if (!excludeWeekends || !isWeekend(s)) out.push(s);
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

/** 'YYYY-MM-DD' for the 1st of the month containing `dateString` (today's
 *  district date by default) — the default start of an attendance summary
 *  range when the caller doesn't pick one. */
function startOfMonthStr(dateString = dateStr()) {
  return dateString.slice(0, 7) + '-01';
}

// 7:30am, the district-wide cutoff a check-in is judged against — "late" if
// strictly after this, "early" otherwise (so a check-in at exactly 7:30:00
// counts as early, not late).
const LATE_CUTOFF_MINUTES = 7 * 60 + 30;

/** 'late' or 'early' for a check-in timestamp, judged against the 7:30am
 *  Africa/Accra cutoff. Accra is UTC+0 with no DST, so a Date's UTC
 *  hour/minute already IS its Accra local time — no timezone conversion
 *  needed beyond that (same reasoning `dayBounds` already relies on). */
function arrivalStatus(at) {
  const d = at instanceof Date ? at : new Date(at);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes > LATE_CUTOFF_MINUTES ? 'late' : 'early';
}

module.exports = { TZ, dateStr, dayBounds, isWeekend, daysBetween, startOfMonthStr, LATE_CUTOFF_MINUTES, arrivalStatus };
