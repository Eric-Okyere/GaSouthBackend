// A staff/GES ID is meant to be one person's district-wide identifier — the
// `{school, staffId}` unique index on the Teacher model only ever stopped
// the same ID being used twice *at the same school*. Nothing previously
// stopped the same ID being registered again at a *different* school (by a
// typo, or a teacher registering themselves a second time after scanning
// the wrong QR code), silently creating two live roster entries — and two
// separate attendance/device-binding histories — for what should be one
// person. This helper is the shared check behind rejecting that, used by
// self-registration and every admin path that can create or rename a
// Teacher's staffId.
//
// Deliberately does not special-case an inactive teacher at the other
// school: an admin who wants to move a teacher to a different school is
// already expected to remove the old record first (see the "Editing a
// teacher's details" note in the README on why school reassignment isn't a
// simple field edit) — so as long as an old record still exists anywhere,
// the same ID isn't free to reuse elsewhere.

/**
 * True if `staffId` already belongs to a Teacher record at a school other
 * than `schoolId`. Pass `excludeTeacherId` when checking an edit to a
 * specific teacher (so renaming a staffId doesn't collide with itself).
 */
async function staffIdTakenElsewhere(Teacher, staffId, schoolId, excludeTeacherId) {
  const filter = { staffId, school: { $ne: schoolId } };
  if (excludeTeacherId) filter._id = { $ne: excludeTeacherId };
  const clash = await Teacher.findOne(filter).lean();
  return !!clash;
}

module.exports = { staffIdTakenElsewhere };
