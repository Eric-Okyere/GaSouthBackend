const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const { distanceMeters } = require('../utils/geo');
const { dateStr, dayBounds } = require('../utils/time');
const { hashDeviceToken } = require('../utils/device');
const { ensureCodesForList, codeOrIdFilter } = require('../utils/schoolCode');

const router = express.Router();

const FLAG_DISTANCE_METERS = Number(process.env.FLAG_DISTANCE_METERS || 300);
const STORE_PRECISE_LOCATION = process.env.STORE_PRECISE_LOCATION === 'true';

/** GET /api/schools — directory listing for QR codes / the public page. */
router.get('/schools', async (req, res, next) => {
  try {
    const schools = await School.find({ active: true }).sort({ name: 1 }).lean();
    // Every school here feeds a QR code or a fallback link on the directory
    // page, so a code is assigned up front for any school that doesn't
    // have one yet (see utils/schoolCode.js).
    await ensureCodesForList(School, schools);
    res.json(
      schools.map((s) => ({
        id: s._id,
        name: s.name,
        code: s.code,
        hasAnchor: s.anchorLat != null && s.anchorLng != null
      }))
    );
  } catch (err) {
    next(err);
  }
});

/** GET /api/schools/:id — header info for the check-in page. `:id` may be a school's Mongo id or its short code. */
router.get('/schools/:id', async (req, res, next) => {
  try {
    const school = await School.findOne(codeOrIdFilter(req.params.id, { active: true })).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const { start, end } = dayBounds(dateStr());
    const todayCount = await Attendance.countDocuments({
      school: school._id,
      type: 'in',
      at: { $gte: start, $lte: end }
    });

    res.json({ id: school._id, name: school.name, todayCount });
  } catch (err) {
    next(err);
  }
});

/** GET /api/schools/:id/status?staffId=... — what happens if this person acts now. */
router.get('/schools/:id/status', async (req, res, next) => {
  try {
    const staffId = String(req.query.staffId || '').trim().toUpperCase();
    if (!staffId) return res.status(400).json({ error: 'staffId is required.' });

    const school = await School.findOne(codeOrIdFilter(req.params.id, { active: true })).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const teacher = await Teacher.findOne({ school: school._id, staffId, active: true }).lean();

    if (!teacher) {
      // Not registered at THIS school. Check whether the staff ID is
      // registered anywhere else, so the check-in page can tell the
      // difference between "you haven't registered at all" and "you scanned
      // the wrong school's QR code" — without naming the other school here
      // (this is a public, unauthenticated endpoint).
      const others = await Teacher.find({ staffId, active: true }).lean();
      const wrongSchool = others.some((t) => String(t.school) !== String(school._id));
      return res.json({
        staffId,
        registered: false,
        wrongSchool,
        verifiedName: null,
        next: 'in',
        checkedInAt: null,
        checkedOutAt: null,
        deviceBound: false
      });
    }

    const today = dateStr();
    const [checkIn, checkOut] = await Promise.all([
      Attendance.findOne({ school: school._id, staffId, type: 'in', dateKey: today }).lean(),
      Attendance.findOne({ school: school._id, staffId, type: 'out', dateKey: today }).lean()
    ]);

    const next_ = !checkIn ? 'in' : !checkOut ? 'out' : 'done';

    // deviceBound tells the check-in page whether this staff ID already has
    // a trusted device on file. If not, this check-in is the one that
    // establishes it — worth a friendly one-time note on the frontend.
    const deviceBound = !!teacher.deviceTokenHash;

    res.json({
      staffId,
      registered: true,
      wrongSchool: false,
      verifiedName: teacher.name,
      next: next_,
      checkedInAt: checkIn ? checkIn.at : null,
      checkedOutAt: checkOut ? checkOut.at : null,
      deviceBound
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/schools/:id/attendance — record a check-in or check-out. */
router.post('/schools/:id/attendance', async (req, res, next) => {
  try {
    const school = await School.findOne(codeOrIdFilter(req.params.id, { active: true })).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    if (!staffId) return res.status(400).json({ error: 'Staff ID is required.' });

    // --- Registration required, scoped to THIS school -----------------------
    // A staff ID must already be on this specific school's roster before it
    // can check in/out — no more creating a roster entry on the fly from a
    // typed name. This is also what stops a teacher registered at one school
    // from checking in at another: the lookup below is scoped to `school`,
    // so a staff ID that only exists at a different school simply isn't
    // found here, same as if it didn't exist anywhere.
    let teacher = await Teacher.findOne({ school: school._id, staffId, active: true });
    if (!teacher) {
      // Distinguish "not registered anywhere" from "registered, but at a
      // different school" for a clearer message — without naming the other
      // school (this is a public, unauthenticated endpoint).
      const others = await Teacher.find({ staffId, active: true }).lean();
      const wrongSchool = others.some((t) => String(t.school) !== String(school._id));
      if (wrongSchool) {
        return res.status(403).json({
          error: 'This staff ID is registered at a different school. Please scan the QR code for your own school.',
          wrongSchool: true
        });
      }
      return res.status(404).json({
        error: 'This staff ID is not registered yet. Please register first, then come back and check in.',
        notRegistered: true
      });
    }
    const name = teacher.name;
    // --- End registration check ----------------------------------------------

    const today = dateStr();
    const [checkIn, checkOut] = await Promise.all([
      Attendance.findOne({ school: school._id, staffId, type: 'in', dateKey: today }).lean(),
      Attendance.findOne({ school: school._id, staffId, type: 'out', dateKey: today }).lean()
    ]);
    if (checkIn && checkOut) {
      return res.status(409).json({
        error: 'Attendance already completed for today.',
        checkedInAt: checkIn.at,
        checkedOutAt: checkOut.at
      });
    }
    const type = checkIn ? 'out' : 'in';

    let distanceM = null;
    let outOfCoverage = false;
    const lat = typeof req.body.lat === 'number' ? req.body.lat : null;
    const lng = typeof req.body.lng === 'number' ? req.body.lng : null;
    if (lat != null && lng != null && school.anchorLat != null && school.anchorLng != null) {
      distanceM = distanceMeters(lat, lng, school.anchorLat, school.anchorLng);
      outOfCoverage = distanceM > FLAG_DISTANCE_METERS;
    }

    // A school with a GPS anchor set rejects a check-in/out from outside its
    // coverage radius outright — nothing is recorded. (A school with no
    // anchor yet, or a device that couldn't get a GPS fix at all, has no
    // distance to check against and is let through, same as before.)
    if (outOfCoverage) {
      return res.status(403).json({
        error: `You appear to be outside ${school.name}'s coverage area. Please go to the school and try again.`,
        outOfCoverage: true,
        distanceM
      });
    }

    // --- Device binding ------------------------------------------------------
    // This is the anti-impersonation control: a staff ID printed on a
    // school's public QR flyer is not secret, so typing it can't prove who's
    // actually standing there. Normally the device is already bound by now
    // — registration binds the phone a teacher registered from (see
    // routes/registration.js) — so this is mostly enforcement: every
    // check-in/out must come from that same device, or it's rejected
    // outright, nothing written. The bind-here branch below only ever fires
    // for a roster entry that reached this point with no device bound yet —
    // an admin added it directly and the teacher never self-registered — in
    // which case this first check-in is what binds it, same as before
    // device binding moved to registration. Deliberately checked only after
    // the same-day-state and coverage checks above, so a request that was
    // going to be rejected anyway never affects device binding.
    const deviceToken = String(req.body.deviceToken || '').trim();
    if (!deviceToken) {
      return res.status(400).json({
        error: "We couldn't identify your device. Please allow this site to store data in your browser and try again.",
        deviceRequired: true
      });
    }
    const deviceTokenHash = hashDeviceToken(deviceToken);

    if (teacher.deviceTokenHash) {
      if (teacher.deviceTokenHash !== deviceTokenHash) {
        return res.status(403).json({
          error: 'This device isn’t recognized for this staff ID. Please check in from the device you first used, or ask your school admin to reset your device.',
          deviceMismatch: true
        });
      }
    } else {
      teacher = await Teacher.findByIdAndUpdate(
        teacher._id,
        { deviceTokenHash, deviceBoundAt: new Date() },
        { new: true }
      );
    }
    // --- End device binding ----------------------------------------------

    const at = new Date();
    let record;
    try {
      record = await Attendance.create({
        school: school._id,
        teacher: teacher._id,
        staffId,
        name,
        type,
        // Always true now — a check-in/out can't happen at all unless the
        // staff ID is already on this school's roster (see the registration
        // check above). The field is kept for continuity with historical
        // records from before registration was required.
        verified: true,
        distanceM,
        flagged: false,
        lat: STORE_PRECISE_LOCATION ? lat : null,
        lng: STORE_PRECISE_LOCATION ? lng : null,
        at,
        dateKey: today
      });
    } catch (err) {
      if (err.code === 11000) {
        // Someone else's request for the same person/day/type won the race.
        return res.status(409).json({ error: 'That check-in/out was already recorded for today.' });
      }
      throw err;
    }

    res.status(201).json({
      type: record.type,
      at: record.at,
      name: record.name,
      verified: record.verified,
      distanceM: record.distanceM,
      flagged: record.flagged
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
