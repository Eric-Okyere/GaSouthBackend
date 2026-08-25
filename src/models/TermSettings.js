const mongoose = require('mongoose');

// GES runs three terms a year, each with its own open ("first day back") and
// closing ("last day of term") date, set by the district ahead of time and
// occasionally adjusted (e.g. a term extended or cut short). This is a
// single settings document for the whole district — not one row per school,
// since term dates are set district-wide, not school-by-school — so admin
// routes always read/write the one document (upserting it into existence on
// first use) rather than looking one up by id.
const termSchema = new mongoose.Schema(
  {
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null }
  },
  { _id: false }
);

const termSettingsSchema = new mongoose.Schema(
  {
    // Free text, e.g. "2026/2027" — just a label shown alongside the dates,
    // not parsed or validated against the term dates themselves.
    academicYear: { type: String, trim: true, default: '' },
    term1: { type: termSchema, default: () => ({}) },
    term2: { type: termSchema, default: () => ({}) },
    term3: { type: termSchema, default: () => ({}) }
  },
  { timestamps: true }
);

module.exports = mongoose.model('TermSettings', termSettingsSchema);
