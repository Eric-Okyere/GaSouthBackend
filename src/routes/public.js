const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const { distanceMeters } = require('../utils/geo');
const { dateStr, dayBounds } = require('../utils/time');

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

    res.json({
      staffId,
      verifiedName: teacher ? teacher.name : null,
      next: next_,
      checkedInAt: checkIn ? checkIn.at : null,
      checkedOutAt: checkOut ? checkOut.at : null
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

    const teacher = await Teacher.findOne({ school: school._id, staffId, active: true }).lean();
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
    let flagged = false;
    const lat = typeof req.body.lat === 'number' ? req.body.lat : null;
    const lng = typeof req.body.lng === 'number' ? req.body.lng : null;
    if (lat != null && lng != null && school.anchorLat != null && school.anchorLng != null) {
      distanceM = distanceMeters(lat, lng, school.anchorLat, school.anchorLng);
      flagged = distanceM > FLAG_DISTANCE_METERS;
    }

    const at = new Date();
    let record;
    try {
      record = await Attendance.create({
        school: school._id,
        teacher: teacher ? teacher._id : null,
        staffId,
        name,
        type,
        verified: !!teacher,
        distanceM,
        flagged,
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
