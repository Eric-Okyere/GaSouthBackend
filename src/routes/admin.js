const express = require('express');
const School = require('../models/School');
const Teacher = require('../models/Teacher');
const Attendance = require('../models/Attendance');
const TermSettings = require('../models/TermSettings');
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

// A teacher may have mistyped something on self-registration (or an admin
// may just have better information later) — this lets an admin correct any
// of the fields the registration form collects, not just the two originally
// supported here. Same validation idiom as POST /api/register: required
// fields reject empty, dateOfBirth is parsed and range-checked, everything
// else is free text trimmed as-is (an empty string clears it back to the
// schema default rather than being rejected, since these are all optional
// on the model).
router.patch('/teachers/:id', async (req, res, next) => {
  try {
    const update = {};
    const body = req.body || {};

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });
      update.name = name;
    }
    if (typeof body.staffId === 'string') {
      const staffId = body.staffId.trim().toUpperCase();
      if (!staffId) return res.status(400).json({ error: 'Staff ID cannot be empty.' });
      update.staffId = staffId;
    }
    if (typeof body.active === 'boolean') update.active = body.active;

    if (typeof body.dateOfBirth === 'string') {
      const raw = body.dateOfBirth.trim();
      if (!raw) {
        update.dateOfBirth = null;
      } else {
        const dateOfBirth = new Date(raw);
        if (Number.isNaN(dateOfBirth.getTime())) {
          return res.status(400).json({ error: 'Date of birth is not a valid date.' });
        }
        update.dateOfBirth = dateOfBirth;
      }
    }
    if (typeof body.classTeaching === 'string') update.classTeaching = body.classTeaching.trim();
    if (typeof body.association === 'string') update.association = body.association.trim();
    if (typeof body.phoneNumber === 'string') update.phoneNumber = body.phoneNumber.trim();

    const teacher = await Teacher.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
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

/**
 * GET /schools/:id/roster-status?date= — every active roster teacher at
 * this school, split into who's checked in on `date` (default today) and
 * who hasn't — so an admin can see at a glance who to follow up with, and
 * reach them directly (phone number included where on file). Unlike
 * attendance-summary (a range, "present days" counted), this is a single
 * day's yes/no split with the actual check-in/out times — the tool for
 * "who's missing today", not historical trends.
 */
router.get('/schools/:id/roster-status', async (req, res, next) => {
  try {
    const school = await School.findById(req.params.id).lean();
    if (!school) return res.status(404).json({ error: 'School not found.' });

    const date = req.query.date || dateStr();

    const [teachers, ins, outs] = await Promise.all([
      Teacher.find({ school: school._id, active: true }).sort({ name: 1 }).lean(),
      Attendance.find({ school: school._id, type: 'in', dateKey: date }).select('staffId at').lean(),
      Attendance.find({ school: school._id, type: 'out', dateKey: date }).select('staffId at').lean()
    ]);

    const checkInAtByStaffId = new Map(ins.map((r) => [r.staffId, r.at]));
    const checkOutAtByStaffId = new Map(outs.map((r) => [r.staffId, r.at]));

    const checkedIn = [];
    const notCheckedIn = [];
    for (const t of teachers) {
      const checkedInAt = checkInAtByStaffId.get(t.staffId);
      const base = { id: t._id, staffId: t.staffId, name: t.name, phoneNumber: t.phoneNumber || '' };
      if (checkedInAt) {
        checkedIn.push({ ...base, checkedInAt, checkedOutAt: checkOutAtByStaffId.get(t.staffId) || null });
      } else {
        notCheckedIn.push(base);
      }
    }

    res.json({ school: { id: school._id, name: school.name }, date, checkedIn, notCheckedIn });
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

/* ------------------------------- District-wide teacher directory ------------------------------- */

/**
 * Every 'in'/'out' Attendance row for the whole district on one day, keyed
 * by `school|staffId` — the shared lookup behind the directory's optional
 * present/absent column and its CSV export, so both compute it the same way
 * instead of drifting. One query per type, not one per teacher.
 */
async function loadDistrictDayStatus(date) {
  const [ins, outs] = await Promise.all([
    Attendance.find({ type: 'in', dateKey: date }).select('school staffId at').lean(),
    Attendance.find({ type: 'out', dateKey: date }).select('school staffId at').lean()
  ]);
  return {
    date,
    inMap: new Map(ins.map((r) => [`${r.school}|${r.staffId}`, r.at])),
    outMap: new Map(outs.map((r) => [`${r.school}|${r.staffId}`, r.at]))
  };
}

/**
 * GET /teachers?school=&date= — every teacher in the district, at every
 * school, active or not, with the school's name attached — the data behind
 * the district-wide Teachers page (sort/search client-side, click through to
 * one teacher's detail). `school` narrows it to one school (an exact filter,
 * distinct from the page's free-text search); `date` attaches that day's
 * check-in/out status to each teacher (default omitted — the plain roster,
 * no status computed) so the page can show "who was here" for a single day
 * without a request per teacher. Deliberately unpaginated, same reasoning as
 * the school directory: a district's whole roster is small enough to sort
 * and search in the browser without round-tripping on every keystroke.
 */
router.get('/teachers', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.school) filter.school = req.query.school;
    const teachers = await Teacher.find(filter).sort({ name: 1 }).populate('school', 'name').lean();

    const status = req.query.date ? await loadDistrictDayStatus(req.query.date) : null;
    res.json(teachers.map((t) => toDirectoryTeacherJSON(t, status)));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /teachers/export?school=&date= — the district directory as a CSV,
 * respecting the same `school` and `date` filters as the page above, so
 * "export what I'm looking at" does exactly that. Registered before
 * `/teachers/:id` so the literal path `/teachers/export` isn't swallowed by
 * that route's `:id` param.
 */
router.get('/teachers/export', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.school) filter.school = req.query.school;
    const teachers = await Teacher.find(filter).sort({ name: 1 }).populate('school', 'name').lean();

    const date = req.query.date;
    const status = date ? await loadDistrictDayStatus(date) : null;

    const header = ['Name', 'Staff ID', 'School', 'Active', 'Class Teaching', 'Association', 'Phone', 'Source', 'Device Bound'];
    if (date) header.push('Status', 'Checked In At', 'Checked Out At');

    const rows = [header, ...teachers.map((t) => {
      const row = [
        t.name,
        t.staffId,
        t.school ? t.school.name : '',
        t.active ? 'Yes' : 'No',
        t.classTeaching || '',
        t.association || '',
        t.phoneNumber || '',
        t.source === 'self' ? 'Self-registered' : 'Admin-added',
        t.deviceTokenHash ? 'Yes' : 'No'
      ];
      if (date) {
        const key = `${t.school ? t.school._id : t.school}|${t.staffId}`;
        const checkedInAt = status.inMap.get(key);
        const checkedOutAt = status.outMap.get(key);
        row.push(checkedInAt ? 'Present' : 'Absent', checkedInAt ? new Date(checkedInAt).toISOString() : '', checkedOutAt ? new Date(checkedOutAt).toISOString() : '');
      }
      return row;
    })];

    const csv = toCSV(rows);
    const filename = `ga-south-teachers${date ? '-' + date : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /teachers/:id — one teacher's full roster record, plus present/absent
 * counts over a date range (`?start=&end=`, default this month so far — same
 * convention as the per-school attendance summary). This is the number an
 * admin actually wants after clicking into someone from the district
 * directory: how many school days they've shown up for vs. missed, not just
 * their contact card.
 */
router.get('/teachers/:id', async (req, res, next) => {
  try {
    const teacher = await Teacher.findById(req.params.id).populate('school', 'name').lean();
    if (!teacher) return res.status(404).json({ error: 'Teacher not found.' });

    const today = dateStr();
    const start = req.query.start || startOfMonthStr(today);
    const end = req.query.end && req.query.end < today ? req.query.end : today; // never count into the future
    if (start > end) return res.status(400).json({ error: 'start must be on or before end.' });

    // Same "count only from whichever is later: range start, or the day
    // they joined" rule as the per-school summary — a teacher added
    // mid-range isn't shown absent for days before they existed.
    const joined = teacher.createdAt ? dateStr(new Date(teacher.createdAt)) : start;
    const effectiveStart = joined > start ? joined : start;
    const allDays = daysBetween(effectiveStart, end, { excludeWeekends: true });

    const checkinRows = allDays.length && teacher.school
      ? await Attendance.find({
          school: teacher.school._id,
          staffId: teacher.staffId,
          type: 'in',
          dateKey: { $gte: effectiveStart, $lte: end }
        }).select('dateKey').lean()
      : [];
    const presentSet = new Set(checkinRows.map((r) => r.dateKey));
    const presentCount = allDays.filter((d) => presentSet.has(d)).length;

    res.json({
      teacher: toDirectoryTeacherJSON(teacher),
      attendance: {
        start,
        end,
        totalSchoolDays: allDays.length,
        presentDays: presentCount,
        absentDays: allDays.length - presentCount
      }
    });
  } catch (err) {
    next(err);
  }
});

function toDirectoryTeacherJSON(t, status) {
  const json = {
    id: t._id,
    staffId: t.staffId,
    name: t.name,
    school: t.school ? { id: t.school._id, name: t.school.name } : null,
    active: t.active,
    source: t.source || 'admin',
    dateOfBirth: t.dateOfBirth || null,
    classTeaching: t.classTeaching || '',
    association: t.association || '',
    phoneNumber: t.phoneNumber || '',
    deviceBound: !!t.deviceTokenHash,
    deviceBoundAt: t.deviceBoundAt || null
  };
  if (status) {
    const key = `${t.school ? t.school._id : t.school}|${t.staffId}`;
    json.attendanceStatus = {
      date: status.date,
      checkedInAt: status.inMap.get(key) || null,
      checkedOutAt: status.outMap.get(key) || null
    };
  }
  return json;
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

/* ------------------------------- Academic term dates ------------------------------- */
// A single district-wide settings document (there's only ever one "current"
// set of term dates, not one per school) covering GES's three terms a year,
// each with an open ("first day back") and closing ("last day of term")
// date. Read/written as a singleton: GET returns it (or all-blank defaults
// if an admin hasn't set anything yet), PUT upserts it into existence on
// first use.

const TERM_KEYS = ['term1', 'term2', 'term3'];
const TERM_LABELS = { term1: 'First term', term2: 'Second term', term3: 'Third term' };

function toTermJSON(term) {
  return {
    startDate: (term && term.startDate) || null,
    endDate: (term && term.endDate) || null
  };
}

function toTermSettingsJSON(doc) {
  return {
    academicYear: (doc && doc.academicYear) || '',
    term1: toTermJSON(doc && doc.term1),
    term2: toTermJSON(doc && doc.term2),
    term3: toTermJSON(doc && doc.term3)
  };
}

router.get('/term-dates', async (req, res, next) => {
  try {
    const doc = await TermSettings.findOne({}).lean();
    res.json(toTermSettingsJSON(doc));
  } catch (err) {
    next(err);
  }
});

router.put('/term-dates', async (req, res, next) => {
  try {
    const body = req.body || {};
    const update = {};

    if (typeof body.academicYear === 'string') update.academicYear = body.academicYear.trim();

    const existing = (await TermSettings.findOne({}).lean()) || {};

    for (const key of TERM_KEYS) {
      if (!(key in body)) continue; // this term wasn't part of the request: leave it untouched
      const raw = body[key] || {};
      const currentTerm = existing[key] || {};
      const merged = { startDate: currentTerm.startDate || null, endDate: currentTerm.endDate || null };

      for (const field of ['startDate', 'endDate']) {
        if (!(field in raw)) continue; // this one field wasn't sent: keep what's on file
        const val = raw[field];
        if (val === null || val === '') {
          merged[field] = null;
          continue;
        }
        const parsed = new Date(val);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({
            error: `${TERM_LABELS[key]}: that ${field === 'startDate' ? 'opening' : 'closing'} date isn't valid.`
          });
        }
        merged[field] = parsed;
      }

      if (merged.startDate && merged.endDate && merged.startDate > merged.endDate) {
        return res.status(400).json({ error: `${TERM_LABELS[key]}: the opening date must be on or before the closing date.` });
      }
      update[key] = merged;
    }

    const saved = await TermSettings.findOneAndUpdate({}, update, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json(toTermSettingsJSON(saved));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
