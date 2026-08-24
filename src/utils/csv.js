function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

module.exports = { toCSV };
