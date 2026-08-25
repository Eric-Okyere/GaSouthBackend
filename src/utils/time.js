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

module.exports = { TZ, dateStr, dayBounds, isWeekend, daysBetween, startOfMonthStr };
