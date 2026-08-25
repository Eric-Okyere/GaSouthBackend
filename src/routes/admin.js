const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const { requireAdmin } = require('../middleware/auth');
const { toCSV } = require('../utils/csv');
const { dateStr, dayBounds, daysBetween, startOfMonthStr } = require('../utils/time');

const router = express.Router();
router.use(requireAdmin);

/* ------------------------------- Schools ------------------------------- */

router.get('/schools', async (req, res, next) => {
  try {
    const schools = await School.find().sort({ name: 1 }).lean();
    res.json(schools.map(toSchoolJSON));
  } catch (err) {
    next(err);
  }
});

router.get('/schools/:id', async (req, res, next) => {
  try {
    const school = await School.findById(req.params.id);
    if (!school) return res.status(404).json({ error: 'School not found.' });
    res.json(toSchoolJSON(school));
  } catch (err) {
    next(err);
  }
});

router.post('/schools', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'School name is required.' });
    const school = await School.create({ name });
    res.status(201).json(toSchoolJSON(school));
  } catch (err) {
    next(err);
  }
});

router.patch('/schools/:id', async (req, res, next) => {
  try {
    const update = {};
    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ error: 'School name cannot be empty.' });
      update.name = name;
    }
    if (typeof req.body.active === 'boolean') update.active = req.body.active;

    const school = await School.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!school) return res.status(404).json({ error: 'School not found.' });
    res.json(toSchoolJSON(school));
  } catch (err) {
    next(err);
  }
});

router.post('/schools/:id/anchor', async (req, res, next) => {
  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng must be numbers.' });
    }
    const school = await School.findByIdAndUpdate(
      req.params.id,
      { anchorLat: lat, anchorLng: lng, anchorSetAt: new Date() },
      { new: true }
    );
    if (!school) return res.status(404).json({ error: 'School not found.' });
    res.json(toSchoolJSON(school));
  } catch (err) {
    next(err);
  }
});

router.delete('/schools/:id/anchor', async (req, res, next) => {
  try {
    const school = await School.findByIdAndUpdate(
      req.params.id,
      { anchorLat: null, anchorLng: null, anchorSetAt: null },
      { new: true }
    );
    if (!school) return res.status(404).json({ error: 'School not found.' });
    res.json(toSchoolJSON(school));
  } catch (err) {
    next(err);
  }
});

// Hard-delete only if nothing references the school; otherwise deactivate,
// so historical attendance records never dangle or silently disappear.
router.delete('/schools/:id', async (req, res, next) => {
  try {
    const inUse = await Attendance.exists({ school: req.params.id });
    if (inUse) {
      const school = await School.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
      if (!school) return res.status(404).json({ error: 'School not found.' });
      return res.json({ deactivated: true, school: toSchoolJSON(school) });
    }
    await Teacher.deleteMany({ school: req.params.id });
    const school = await School.findByIdAndDelete(req.params.id);
    if (!school) return res.status(404).json({ error: 'School not found.' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

function toSchoolJSON(s) {
  return {
    id: s._id,
    name: s.name,
    active: s.active,
    anchorLat: s.anchorLat,
    anchorLng: s.anchorLng,
    anchorSetAt: s.anchorSetAt
  };
}

/* ------------------------------- Teachers (roster) ------------------------------- */

router.get('/schools/:id/teachers', async (req, res, next) => {
  try {
    const teachers = await Teacher.find({ school: req.params.id }).sort({ name: 1 }).lean();
    res.json(teachers.map(toTeacherJSON));
  } catch (err) {
    next(err);
  }
});

router.post('/schools/:id/teachers', async (req, res, next) => {
  try {
    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    const name = String(req.body.name || '').trim();
    if (!staffId || !name) return res.status(400).json({ error: 'staffId and name are required.' });

    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const teacher = await Teacher.create({ school: school._id, staffId, name });
    res.status(201).json(toTeacherJSON(teacher));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That staff ID already exists at this school.' });
    next(err);
  }
});

// Bulk import, e.g. from a pasted CSV parsed client-side into rows.
router.post('/schools/:id/teachers/bulk', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    let created = 0;
    let updated = 0;
    const skipped = [];

    for (const row of rows) {
      const staffId = String(row.staffId || '').trim().toUpperCase();
      const name = String(row.name || '').trim();
      if (!staffId || !name) {
        skipped.push({ row, reason: 'missing staffId or name' });
        continue;
      }
      const result = await Teacher.findOneAndUpdate(
        { school: school._id, staffId },
        { name, active: true },
        { upsert: true, new: true, rawResult: true }
      );
      if (result.lastErrorObject && result.lastErrorObject.upserted) created += 1;
      else updated += 1;
    }

    res.json({ created, updated, skipped });
  } catch (err) {
    next(err);
  }
});

router.patch('/teachers/:id', async (req, res, next) => {
  try {
    const update = {};
    if (typeof req.body.name === 'string') update.name = req.body.name.trim();
    if (typeof req.body.staffId === 'string') update.staffId = req.body.staffId.trim().toUpperCase();
    if (typeof req.body.active === 'boolean') update.active = req.body.active;

    const teacher = await Teacher.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });
    res.json(toTeacherJSON(teacher));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'That staff ID already exists at this school.' });
    next(err);
  }
});

router.delete('/teachers/:id', async (req, res, next) => {
  try {
    const teacher = await Teacher.findByIdAndDelete(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /teachers/:id/reset-device — admin-only escape hatch for a teacher
 * whose trusted device is gone (new phone, factory reset, cleared browser
 * data) or a suspected-shared device that needs to stop working. Clears the
 * binding; the next check-in binds a fresh device, same as a brand-new
 * staff ID. Deliberately admin-authenticated only — no public self-service
 * flow, since anyone able to trigger that would defeat the whole point.
 */
router.post('/teachers/:id/reset-device', async (req, res, next) => {
  try {
    const teacher = await Teacher.findByIdAndUpdate(
      req.params.id,
      { deviceTokenHash: null, deviceBoundAt: null },
      { new: true }
    );
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });
    res.json(toTeacherJSON(teacher));
  } catch (err) {
    next(err);
  }
});

/** GET /schools/:id/totals — all-time check-in/check-out counts for one school. */
router.get('/schools/:id/totals', async (req, res, next) => {
  try {
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const [checkins, checkouts] = await Promise.all([
      Attendance.countDocuments({ school: school._id, type: 'in' }),
      Attendance.countDocuments({ school: school._id, type: 'out' })
    ]);
    res.json({ checkins, checkouts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /schools/:id/attendance-summary?start=&end= — present/absent counts
 * per active roster teacher over a date range (default: this month so far).
 * "Present" = at least one check-in that day; "absent" = a school day with
 * none. Weekends are excluded (schools aren't normally in session). A
 * teacher's count only starts from whichever is later: the range start, or
 * the day they joined the roster — so a teacher added mid-month isn't shown
 * absent for days before they existed.
 */
router.get('/schools/:id/attendance-summary', async (req, res, next) => {
  try {
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const today = dateStr();
    const start = req.query.start || startOfMonthStr(today);
    const end = req.query.end && req.query.end < today ? req.query.end : today; // never count into the future
    if (start > end) return res.status(400).json({ error: 'start must be on or before end.' });

    const [teachers, checkinRows] = await Promise.all([
      Teacher.find({ school: school._id, active: true }).sort({ name: 1 }).lean(),
      Attendance.find({ school: school._id, type: 'in', dateKey: { $gte: start, $lte: end } })
        .select('staffId dateKey')
        .lean()
    ]);

    const presentDays = new Map(); // staffId -> Set of dateKey
    for (const r of checkinRows) {
      if (!presentDays.has(r.staffId)) presentDays.set(r.staffId, new Set());
      presentDays.get(r.staffId).add(r.dateKey);
    }

    const allDays = daysBetween(start, end, { excludeWeekends: true });

    const summary = teachers.map((t) => {
      const joined = t.createdAt ? dateStr(new Date(t.createdAt)) : start;
      const effectiveStart = joined > start ? joined : start;
      const days = allDays.filter((d) => d >= effectiveStart);
      const present = presentDays.get(t.staffId) || new Set();
      const presentCount = days.filter((d) => present.has(d)).length;
      return {
        id: t._id,
        staffId: t.staffId,
        name: t.name,
        phoneNumber: t.phoneNumber || '',
        totalSchoolDays: days.length,
        presentDays: presentCount,
        absentDays: days.length - presentCount
      };
    });

    res.json({ school: { id: school._id, name: school.name }, start, end, teachers: summary });
  } catch (err) {
    next(err);
  }
});

function toTeacherJSON(t) {
  return {
    id: t._id,
    school: t.school,
    staffId: t.staffId,
    name: t.name,
    active: t.active,
    source: t.source || 'admin',
    dateOfBirth: t.dateOfBirth || null,
    classTeaching: t.classTeaching || '',
    association: t.association || '',
    phoneNumber: t.phoneNumber || '',
    deviceBound: !!t.deviceTokenHash,
    deviceBoundAt: t.deviceBoundAt || null
  };
}

/* ------------------------------- Records ------------------------------- */

function buildRecordFilter(query) {
  const filter = {};
  if (query.school) filter.school = query.school;
  if (query.date) filter.dateKey = query.date;
  if (query.staffId) filter.staffId = String(query.staffId).trim().toUpperCase();
  if (query.flagged === 'true') filter.flagged = true;
  if (query.verified === 'false') filter.verified = false;
  return filter;
}

router.get('/records', async (req, res, next) => {
  try {
    const filter = buildRecordFilter(req.query);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));

    const [records, total] = await Promise.all([
      Attendance.find(filter)
        .sort({ at: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate('school', 'name')
        .lean(),
      Attendance.countDocuments(filter)
    ]);

    res.json({
      total,
      page,
      pageSize,
      records: records.map(toRecordJSON)
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/records/:id', async (req, res, next) => {
  try {
    const record = await Attendance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

router.get('/records/export', async (req, res, next) => {
  try {
    const filter = buildRecordFilter(req.query);
    const records = await Attendance.find(filter).sort({ at: -1 }).populate('school', 'name').lean();

    const header = ['Date', 'Time', 'School', 'Teacher Name', 'Staff ID', 'Type', 'Verified', 'Distance (m)', 'Flagged'];
    const rows = [header, ...records.map((r) => [
      r.dateKey,
      new Date(r.at).toISOString(),
      r.school ? r.school.name : '(deleted school)',
      r.name,
      r.staffId,
      r.type === 'in' ? 'Check-in' : 'Check-out',
      r.verified ? 'Yes' : 'No',
      r.distanceM ?? '',
      r.flagged ? 'Yes' : 'No'
    ])];

    const csv = toCSV(rows);
    const filename = `ga-south-attendance${req.query.date ? '-' + req.query.date : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

function toRecordJSON(r) {
  return {
    id: r._id,
    school: r.school ? { id: r.school._id, name: r.school.name } : null,
    staffId: r.staffId,
    name: r.name,
    type: r.type,
    verified: r.verified,
    distanceM: r.distanceM,
    flagged: r.flagged,
    at: r.at,
    dateKey: r.dateKey
  };
}

/**
 * GET /open-checkins?date=&school= — teachers checked IN on `date` (default
 * today) who have no matching check-OUT yet. Click-through target: pair
 * each row with /admin/records?school=&staffId= to see that person's records.
 */
router.get('/open-checkins', async (req, res, next) => {
  try {
    const date = req.query.date || dateStr();
    const filter = { type: 'in', dateKey: date };
    if (req.query.school) filter.school = req.query.school;

    const ins = await Attendance.find(filter).sort({ at: 1 }).populate('school', 'name').lean();
    if (!ins.length) return res.json({ date, openCheckins: [] });

    const outFilter = { type: 'out', dateKey: date };
    if (req.query.school) outFilter.school = req.query.school;
    const outs = await Attendance.find(outFilter).lean();
    const checkedOut = new Set(outs.map((o) => `${o.school}|${o.staffId}`));

    const stillIn = ins.filter((r) => !checkedOut.has(`${r.school ? r.school._id : r.school}|${r.staffId}`));

    // Enrich with a phone number from the roster where one's on file, so
    // the admin can call/WhatsApp straight from this list.
    const teachers = stillIn.length
      ? await Teacher.find({ staffId: { $in: stillIn.map((r) => r.staffId) } }).select('school staffId phoneNumber').lean()
      : [];
    const phoneByKey = new Map(teachers.map((t) => [`${t.school}|${t.staffId}`, t.phoneNumber || '']));

    const openCheckins = stillIn.map((r) => ({
      id: r._id,
      school: r.school ? { id: r.school._id, name: r.school.name } : null,
      staffId: r.staffId,
      name: r.name,
      checkedInAt: r.at,
      phoneNumber: phoneByKey.get(`${r.school ? r.school._id : r.school}|${r.staffId}`) || ''
    }));

    res.json({ date, openCheckins });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------- Stats ------------------------------- */

router.get('/stats/today', async (req, res, next) => {
  try {
    const today = dateStr();
    const { start, end } = dayBounds(today);

    const [schools, todays] = await Promise.all([
      School.find({ active: true }).select('name').lean(),
      Attendance.find({ at: { $gte: start, $lte: end } }).lean()
    ]);

    const perSchoolMap = new Map(schools.map((s) => [String(s._id), { schoolId: s._id, name: s.name, in: 0, out: 0 }]));
    let checkins = 0;
    let checkouts = 0;
    let flagged = 0;
    const reporting = new Set();

    for (const r of todays) {
      const key = String(r.school);
      const bucket = perSchoolMap.get(key);
      if (r.type === 'in') {
        checkins += 1;
        reporting.add(key);
        if (bucket) bucket.in += 1;
      } else {
        checkouts += 1;
        if (bucket) bucket.out += 1;
      }
      if (r.flagged) flagged += 1;
    }

    res.json({
      date: today,
      totalSchools: schools.length,
      schoolsReporting: reporting.size,
      checkins,
      checkouts,
      flagged,
      perSchool: Array.from(perSchoolMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
