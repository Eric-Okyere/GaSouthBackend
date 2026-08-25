const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const { distanceMeters } = require('../utils/geo');
const { dateStr, dayBounds } = require('../utils/time');
const { MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES, isValidPin, hashPin, comparePin, isLockedOut } = require('../utils/pin');
const { recognizeDevice } = require('../utils/device');

const router = express.Router();

const FLAG_DISTANCE_METERS = Number(process.env.FLAG_DISTANCE_METERS || 300);
const STORE_PRECISE_LOCATION = process.env.STORE_PRECISE_LOCATION === 'true';

/** GET /api/schools — directory listing for QR codes / the public page. */
router.get('/schools', async (req, res, next) => {
  try {
    const schools = await School.find({ active: true }).sort({ name: 1 }).lean();
    res.json(
      schools.map((s) => ({
        id: s._id,
        name: s.name,
        hasAnchor: s.anchorLat != null && s.anchorLng != null
      }))
    );
  } catch (err) {
    next(err);
  }
});

/** GET /api/schools/:id — header info for the check-in page. */
router.get('/schools/:id', async (req, res, next) => {
  try {
    const school = await School.findOne({ _id: req.params.id, active: true }).lean();
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

    const school = await School.findOne({ _id: req.params.id, active: true }).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const teacher = await Teacher.findOne({ school: school._id, staffId, active: true }).lean();

    const today = dateStr();
    const [checkIn, checkOut] = await Promise.all([
      Attendance.findOne({ school: school._id, staffId, type: 'in', dateKey: today }).lean(),
      Attendance.findOne({ school: school._id, staffId, type: 'out', dateKey: today }).lean()
    ]);

    const next_ = !checkIn ? 'in' : !checkOut ? 'out' : 'done';

    // hasPin tells the check-in page whether to prompt "create a PIN" (first
    // time this staff ID is ever seen, or an older roster entry from before
    // this feature existed) or "enter your PIN" (every time after that).
    const hasPin = !!(teacher && teacher.pinHash);
    const locked = !!(teacher && isLockedOut(teacher));

    res.json({
      staffId,
      verifiedName: teacher ? teacher.name : null,
      next: next_,
      checkedInAt: checkIn ? checkIn.at : null,
      checkedOutAt: checkOut ? checkOut.at : null,
      hasPin,
      locked,
      lockedUntil: locked ? teacher.pinLockedUntil : null
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/schools/:id/attendance — record a check-in or check-out. */
router.post('/schools/:id/attendance', async (req, res, next) => {
  try {
    const school = await School.findOne({ _id: req.params.id, active: true }).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    if (!staffId) return res.status(400).json({ error: 'Staff ID is required.' });

    // Not .lean() — a PIN may need to be created or its attempt count
    // updated on this same document below.
    let teacher = await Teacher.findOne({ school: school._id, staffId, active: true });
    // Recorded on the Attendance row below as `verified` — was this staff ID
    // already on the roster *before* this request, as opposed to a roster
    // entry the PIN step below is about to create on the fly.
    const wasOnRoster = !!teacher;
    const typedName = String(req.body.name || '').trim();
    if (!teacher && !typedName) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    const name = teacher ? teacher.name : typedName;

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

    // --- Individual PIN check ---------------------------------------------
    // This is the anti-impersonation control: a staff ID printed on a
    // school's public QR flyer is not secret, so it can't prove who's
    // actually standing there. A PIN chosen privately by the teacher can.
    // First time a staff ID is ever used to check in (no PIN on file yet,
    // whether because the roster entry is brand new or predates this
    // feature), the submitted PIN becomes that teacher's PIN going forward.
    // Every time after that, the submitted PIN must match. Deliberately
    // checked only after the same-day-state and coverage checks above, so a
    // request that was going to be rejected anyway doesn't burn a PIN
    // attempt or lock someone out over a redundant tap.
    const pin = String(req.body.pin || '').trim();
    const pinConfirm = req.body.pinConfirm != null ? String(req.body.pinConfirm).trim() : null;
    const hasPin = !!(teacher && teacher.pinHash);

    if (teacher && isLockedOut(teacher)) {
      const minutesLeft = Math.max(1, Math.ceil((new Date(teacher.pinLockedUntil).getTime() - Date.now()) / 60000));
      return res.status(423).json({
        error: `Too many incorrect PIN attempts. Try again in about ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
        locked: true,
        lockedUntil: teacher.pinLockedUntil
      });
    }

    if (!hasPin) {
      if (!isValidPin(pin)) {
        return res.status(400).json({ error: 'Choose a 4–6 digit PIN.', pinRequired: true, creatingPin: true });
      }
      if (pinConfirm === null || pin !== pinConfirm) {
        return res.status(400).json({ error: 'PIN and confirmation do not match.', pinRequired: true, creatingPin: true });
      }
      const pinHash = await hashPin(pin);
      if (teacher) {
        teacher = await Teacher.findByIdAndUpdate(
          teacher._id,
          { pinHash, failedPinAttempts: 0, pinLockedUntil: null },
          { new: true }
        );
      } else {
        teacher = await Teacher.create({
          school: school._id,
          staffId,
          name,
          source: 'checkin',
          pinHash
        });
      }
    } else {
      if (!isValidPin(pin)) {
        return res.status(400).json({ error: 'Enter your 4–6 digit PIN.', pinRequired: true });
      }
      const ok = await comparePin(pin, teacher.pinHash);
      if (!ok) {
        const failedPinAttempts = (teacher.failedPinAttempts || 0) + 1;
        const locked = failedPinAttempts >= MAX_FAILED_ATTEMPTS;
        const update = locked
          ? { failedPinAttempts: 0, pinLockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) }
          : { failedPinAttempts };
        teacher = await Teacher.findByIdAndUpdate(teacher._id, update, { new: true });
        if (locked) {
          return res.status(423).json({
            error: `Too many incorrect PIN attempts. Try again in about ${LOCKOUT_MINUTES} minutes.`,
            locked: true,
            lockedUntil: teacher.pinLockedUntil
          });
        }
        return res.status(401).json({
          error: 'Incorrect PIN.',
          pinRequired: true,
          attemptsRemaining: MAX_FAILED_ATTEMPTS - failedPinAttempts
        });
      }
      if (teacher.failedPinAttempts) {
        teacher = await Teacher.findByIdAndUpdate(teacher._id, { failedPinAttempts: 0 }, { new: true });
      }
    }
    // --- End PIN check ------------------------------------------------------

    // --- Recognized-device signal -------------------------------------------
    // Soft companion to the PIN (see utils/device.js): flags a record when
    // the correct PIN came from a browser we haven't seen succeed before,
    // without blocking it — this token is easy to lose honestly (private
    // browsing, a cleared cache, a new phone), so it's evidence for an
    // admin to review, not grounds to reject a check-in/out outright.
    const deviceToken = String(req.body.deviceToken || '').trim();
    const { deviceTokens, newDevice } = recognizeDevice(teacher.deviceTokens, deviceToken);
    teacher = await Teacher.findByIdAndUpdate(teacher._id, { deviceTokens }, { new: true });
    // --- End recognized-device signal ---------------------------------------

    const at = new Date();
    let record;
    try {
      record = await Attendance.create({
        school: school._id,
        teacher: teacher ? teacher._id : null,
        staffId,
        name,
        type,
        verified: wasOnRoster,
        distanceM,
        flagged: false,
        newDevice,
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
      flagged: record.flagged,
      newDevice: record.newDevice
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
