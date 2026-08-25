const crypto = require('crypto');
const mongoose = require('mongoose');

// Excludes 0/O, 1/I/L, and U — letters and digits that are easy to
// mis-read off a printed flyer or mis-type on a phone keyboard.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 5;

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

/** Generates a code guaranteed not to collide with any existing school. */
async function generateUniqueCode(School) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomCode();
    // eslint-disable-next-line no-await-in-loop
    const clash = await School.exists({ code });
    if (!clash) return code;
  }
  throw new Error('Could not generate a unique school code after 20 attempts.');
}

/**
 * Schools created before this feature shipped have no `code` yet. Rather
 * than requiring every self-hosted deployment to run a manual migration, a
 * school without one is assigned a code the first time it's read back as a
 * real (non-lean) document — a school created after this feature always
 * gets one immediately at creation time (see routes/admin.js POST /schools),
 * so this only ever does real work once per pre-existing school.
 */
async function ensureCode(School, school) {
  if (school.code) return school;
  school.code = await generateUniqueCode(School);
  await school.save();
  return school;
}

/**
 * Same backfill, batched for a list of plain (.lean()) school objects —
 * used by the list endpoints that feed the QR/link-generating pages.
 * Mutates the objects in place (adding `code`) and returns the array.
 */
async function ensureCodesForList(School, schools) {
  for (const s of schools) {
    if (s.code) continue;
    // eslint-disable-next-line no-await-in-loop
    const code = await generateUniqueCode(School);
    // eslint-disable-next-line no-await-in-loop
    await School.findByIdAndUpdate(s._id, { code });
    s.code = code;
  }
  return schools;
}

/**
 * Builds a findOne-style filter that accepts either a school's Mongo id or
 * its short code — so a printed/typed link works whichever one it carries.
 * Codes are always 5 characters from a 31-character alphabet, never a valid
 * ObjectId shape, so the two never collide.
 */
function codeOrIdFilter(idOrCode, extra = {}) {
  const value = String(idOrCode || '');
  if (mongoose.Types.ObjectId.isValid(value)) {
    return { _id: value, ...extra };
  }
  return { code: value.toUpperCase(), ...extra };
}

module.exports = { randomCode, generateUniqueCode, ensureCode, ensureCodesForList, codeOrIdFilter };
