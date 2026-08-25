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
    // automatically the first time this staff ID checked in and set a PIN.
    source: { type: String, enum: ['admin', 'self', 'checkin'], default: 'admin' },
    // Everything below is optional — only ever populated via self-registration.
    dateOfBirth: { type: Date, default: null },
    classTeaching: { type: String, trim: true, default: '' },
    association: { type: String, trim: true, default: '' },
    phoneNumber: { type: String, trim: true, default: '' },
    // Anti-impersonation: a teacher sets a PIN the first time they ever
    // check in, and must re-enter the same PIN for every check-in/check-out
    // after that. The staff ID alone isn't enough to prove identity — it's
    // printed on the school's public QR flyer, so any coworker can read it
    // — but the PIN is chosen privately by the teacher and only its hash is
    // ever stored, so no one else (including admins) can check in on their
    // behalf. Deliberately never set via /register (see routes/registration.js)
    // — only from the check-in flow itself, the one place someone has to
    // actually be present to use.
    pinHash: { type: String, default: null },
    // Basic brute-force lockout: too many wrong PINs in a row locks the
    // staff ID out for a short cool-down instead of allowing unlimited
    // guesses against a short numeric PIN.
    failedPinAttempts: { type: Number, default: 0 },
    pinLockedUntil: { type: Date, default: null },
    // Soft companion to the PIN: browsers that have successfully used this
    // staff ID's PIN before (see utils/device.js). A PIN can be read aloud
    // over a phone call; this makes that shortcut visible by flagging a
    // check-in from an unrecognized browser for admin review — it never
    // blocks the check-in itself, since this signal is easy to lose
    // honestly (private browsing, a cleared cache, a new phone).
    deviceTokens: {
      type: [
        new mongoose.Schema(
          {
            tokenHash: { type: String, required: true },
            firstSeenAt: { type: Date, default: Date.now },
            lastSeenAt: { type: Date, default: Date.now }
          },
          { _id: false }
        )
      ],
      default: []
    }
  },
  { timestamps: true }
);

// A staff ID only needs to be unique within its own school.
teacherSchema.index({ school: 1, staffId: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);
