const express = require('express');
const mongoose = require('mongoose');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const { hashDeviceToken } = require('../utils/device');

// Note on device binding: the phone a teacher registers from becomes their
// trusted device, exactly like a first check-in used to (see
// routes/public.js) — binding happens here, at registration, so a teacher
// can never complete even one check-in from a phone that isn't theirs.
//
// It only ever binds ONCE per roster entry, on whichever submission is the
// first to see no device on file yet — the entry's very first registration,
// or a later self-registration for a staff ID an admin had added directly
// (which never binds a device on its own). A resubmission once a device is
// already bound never rebinds it: this form has no authentication and
// upserts purely on {school, staffId} — both of which a colleague could
// type in on a teacher's behalf just as easily as their own — so letting a
// later resubmission move the binding would reopen exactly the
// impersonation gap device binding exists to close. Every other field
// (name, phone number, etc.) still updates normally on a resubmission;
// only the device binding itself is left alone once set.

const router = express.Router();

// Shown as preset choices on the registration form; a teacher can still type
// something else via "Other", so this is a helpful default, not a hard
// backend restriction — the field is stored as free text either way.
const COMMON_ASSOCIATIONS = ['GNAT', 'NAGRAT', 'CCT-GH'];

/** GET /api/register/associations — presets for the dropdown. */
router.get('/register/associations', (req, res) => {
  res.json(COMMON_ASSOCIATIONS);
});

/**
 * POST /api/register — public teacher self-registration.
 * A teacher fills this in once (from a shared link/QR, not a per-school
 * one — they pick their school here). Writes to the same Teacher
 * collection/unique index as the admin roster: registering again with the
 * same staff ID at the same school updates that entry instead of creating
 * a duplicate, so a typo can be corrected by re-submitting.
 */
router.post('/register', async (req, res, next) => {
  try {
    const schoolId = String(req.body.school || '').trim();
    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    const phoneNumber = String(req.body.phoneNumber || '').trim();
    const association = String(req.body.association || '').trim();
    const classTeaching = String(req.body.classTeaching || '').trim();
    const dateOfBirthRaw = String(req.body.dateOfBirth || '').trim();
    const deviceToken = String(req.body.deviceToken || '').trim();

    const missing = [];
    if (!schoolId) missing.push('school');
    if (!staffId) missing.push('staff ID');
    if (!name) missing.push('name');
    if (!phoneNumber) missing.push('phone number');
    if (!association) missing.push("teachers' association");
    if (!dateOfBirthRaw) missing.push('date of birth');
    if (missing.length) {
      return res.status(400).json({ error: `Please fill in: ${missing.join(', ')}.` });
    }

    const dateOfBirth = new Date(dateOfBirthRaw);
    if (Number.isNaN(dateOfBirth.getTime())) {
      return res.status(400).json({ error: 'Date of birth is not a valid date.' });
    }

    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return res.status(404).json({ error: 'Please choose a valid school.' });
    }
    const school = await School.findOne({ _id: schoolId, active: true }).lean();
    if (!school) return res.status(404).json({ error: 'Please choose a valid school.' });

    const existing = await Teacher.findOne({ school: school._id, staffId }).lean();

    const update = {
      name,
      active: true,
      source: 'self',
      dateOfBirth,
      classTeaching,
      association,
      phoneNumber
    };
    // Bind the device only if nothing is bound yet (see the note above) —
    // omitting these keys entirely when we don't intend to bind leaves
    // whatever's already on the record untouched.
    if (deviceToken && !(existing && existing.deviceTokenHash)) {
      update.deviceTokenHash = hashDeviceToken(deviceToken);
      update.deviceBoundAt = new Date();
    }

    const teacher = await Teacher.findOneAndUpdate({ school: school._id, staffId }, update, { upsert: true, new: true });

    res.status(existing ? 200 : 201).json({
      updated: !!existing,
      teacher: {
        id: teacher._id,
        school: teacher.school,
        staffId: teacher.staffId,
        name: teacher.name
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
