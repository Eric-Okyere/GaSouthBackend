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

module.exports = { TZ, dateStr, dayBounds };
