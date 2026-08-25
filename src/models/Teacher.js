const mongoose = require('mongoose');

// A school's teacher roster. Optional in the sense that check-in still works
// for a staff ID with no roster entry (recorded as "unverified"), but a
// roster entry lets the server confirm the teacher's real name instead of
// trusting whatever was typed, and lets an admin see who hasn't shown up.
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
    // 'checkin' = the roster entry didn't exist yet and was created
    // automatically the first time this staff ID checked in and bound a device.
    source: { type: String, enum: ['admin', 'self', 'checkin'], default: 'admin' },
    // Everything below is optional — only ever populated via self-registration.
    dateOfBirth: { type: Date, default: null },
    classTeaching: { type: String, trim: true, default: '' },
    association: { type: String, trim: true, default: '' },
    phoneNumber: { type: String, trim: true, default: '' },
    // Anti-impersonation: the browser a teacher first checks in from becomes
    // this staff ID's trusted device — every check-in/out after that must
    // come from the same browser, or it's rejected outright (see
    // routes/public.js). The staff ID alone can't prove identity, since it's
    // printed on the school's public QR flyer for anyone to read; binding to
    // the device that "logged in" first is what does. Only the hash of the
    // device token is ever stored, and it's set only from the check-in flow
    // itself (never from /register, which has no way to verify who's
    // actually submitting it) — the one place a person has to actually be
    // using their own phone to trigger.
    deviceTokenHash: { type: String, default: null },
    deviceBoundAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// A staff ID only needs to be unique within its own school.
teacherSchema.index({ school: 1, staffId: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);
