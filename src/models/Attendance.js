const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', default: null },

    // What was actually entered at the kiosk/phone — kept even when it
    // matches a roster entry, so the raw input is always auditable.
    staffId: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },

    type: { type: String, enum: ['in', 'out'], required: true },

    // True when `staffId` matched an active roster entry for this school
    // at the time of check-in (so `name` is the roster's name, not typed).
    verified: { type: Boolean, default: false },

    // Distance in meters from the school's GPS anchor, if the school has
    // one and the device provided a location. Null when either is missing.
    distanceM: { type: Number, default: null },
    flagged: { type: Boolean, default: false },

    // True when this check-in/out's PIN was correct but came from a browser
    // we haven't seen succeed with this staff ID's PIN before (see
    // utils/device.js). A soft signal, not a rejection — surfaced to admins
    // in Records so a pattern (or a one-off phone upgrade) is visible.
    newDevice: { type: Boolean, default: false },

    // Only populated when STORE_PRECISE_LOCATION=true — see .env.example.
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    // Server-assigned moment of the action — never trust a client timestamp.
    at: { type: Date, required: true, default: Date.now },

    // 'YYYY-MM-DD' in Africa/Accra, denormalized from `at` at write time.
    // Backs the unique index below, which is what actually stops a double
    // check-in/out (e.g. an accidental double-tap) at the database level.
    dateKey: { type: String, required: true }
  },
  { timestamps: true }
);

attendanceSchema.index({ school: 1, at: -1 });
attendanceSchema.index(
  { school: 1, staffId: 1, type: 1, dateKey: 1 },
  { unique: true }
);

module.exports = mongoose.model('Attendance', attendanceSchema);
