const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const { distanceMeters } = require('../utils/geo');
const { dateStr, dayBounds } = require('../utils/time');
const { hashDeviceToken } = require('../utils/device');

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

    // deviceBound tells the check-in page whether this staff ID already has
    // a trusted device on file. If not, this check-in is the one that
    // establishes it — worth a friendly one-time note on the frontend.
    const deviceBound = !!(teacher && teacher.deviceTokenHash);

    res.json({
      staffId,
      verifiedName: teacher ? teacher.name : null,
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
    const school = await School.findOne({ _id: req.params.id, active: true }).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    if (!staffId) return res.status(400).json({ error: 'Staff ID is required.' });

    let teacher = await Teacher.findOne({ school: school._id, staffId, active: true });
    // Recorded on the Attendance row below as `verified` — was this staff ID
    // already on the roster *before* this request, as opposed to a roster
    // entry the device-binding step below is about to create on the fly.
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

    // --- Device binding ------------------------------------------------------
    // This is the anti-impersonation control: a staff ID printed on a
    // school's public QR flyer is not secret, so typing it can't prove who's
    // actually standing there. The first check-in for a staff ID ("logging
    // in" for the first time) binds it to that browser; every check-in/out
    // after that must come from the same device, or it's rejected outright
    // — nothing is written. Deliberately checked only after the same-day-
    // state and coverage checks above, so a request that was going to be
    // rejected anyway never affects device binding.
    const deviceToken = String(req.body.deviceToken || '').trim();
    if (!deviceToken) {
      return res.status(400).json({
        error: "We couldn't identify your device. Please allow this site to store data in your browser and try again.",
        deviceRequired: true
      });
    }
    const deviceTokenHash = hashDeviceToken(deviceToken);

    if (teacher && teacher.deviceTokenHash) {
      if (teacher.deviceTokenHash !== deviceTokenHash) {
        return res.status(403).json({
          error: 'This device isn’t recognized for this staff ID. Please check in from the device you first used, or ask your school admin to reset your device.',
          deviceMismatch: true
        });
      }
    } else if (teacher) {
      teacher = await Teacher.findByIdAndUpdate(
        teacher._id,
        { deviceTokenHash, deviceBoundAt: new Date() },
        { new: true }
      );
    } else {
      teacher = await Teacher.create({
        school: school._id,
        staffId,
        name,
        source: 'checkin',
        deviceTokenHash,
        deviceBoundAt: new Date()
      });
    }
    // --- End device binding ----------------------------------------------

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
