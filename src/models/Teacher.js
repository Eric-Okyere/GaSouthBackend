const mongoose = require('mongoose');

// A school's teacher roster. A roster entry — scoped to one specific school
// — is now required before that staff ID can check in/out at all: it's what
// lets the server confirm the teacher's real name instead of trusting
// whatever was typed, and, just as importantly, it's what proves a staff ID
// belongs to the school whose QR code was scanned (see routes/public.js —
// a staff ID registered at School A is rejected at School B's check-in,
// never silently accepted).
//
// Entries get here two ways: an admin adds them directly (staffId + name
// only, `source: 'admin'`), or a teacher fills in the public self-registration
// form (`source: 'self'`), which also collects the extra profile fields
// below. Both paths write to the same collection/unique index, so a teacher
// who self-registers after an admin already added their staff ID just
// updates that entry instead of creating a duplicate.
const teacherSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    staffId: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    // 'checkin' is legacy-only — earlier versions of this app auto-created a
    // roster entry the first time an unregistered staff ID checked in. That
    // path no longer exists (registration is required up front now), so no
    // new entry will ever get this value, but old records may still have it.
    source: { type: String, enum: ['admin', 'self', 'checkin'], default: 'admin' },
    // Everything below is optional — only ever populated via self-registration.
    dateOfBirth: { type: Date, default: null },
    classTeaching: { type: String, trim: true, default: '' },
    association: { type: String, trim: true, default: '' },
    phoneNumber: { type: String, trim: true, default: '' },
    // Anti-impersonation: the browser a teacher registers from becomes this
    // staff ID's trusted device — every check-in/out after that must come
    // from the same browser, or it's rejected outright (see
    // routes/public.js and routes/registration.js). The staff ID alone
    // can't prove identity, since it's printed on the school's public QR
    // flyer for anyone to read; binding to the device that registered (or,
    // for a roster entry an admin added directly with no registration
    // step, the device that first checks in) is what does. Only the hash
    // of the device token is ever stored, and it's set exactly once — the
    // first submission that finds no device bound yet, whether that's a
    // registration or a check-in.
    deviceTokenHash: { type: String, default: null },
    deviceBoundAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// A staff ID only needs to be unique within its own school.
teacherSchema.index({ school: 1, staffId: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);
