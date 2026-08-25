const bcrypt = require('bcryptjs');

// A teacher's PIN is what stops one colleague checking in for another: the
// staff ID printed on a school's QR flyer is not a secret (anyone at the
// school can read it), so it can't be the thing that proves "this is really
// me". The PIN is chosen privately by each teacher and never leaves this
// module as plain text once stored — only the bcrypt hash is persisted.

const PIN_PATTERN = /^\d{4,6}$/;

// A short lockout after repeated wrong guesses. Deliberately not longer:
// this is meant to blunt casual guessing at a 4–6 digit PIN, not to lock a
// teacher out of their own attendance for the day over a couple of typos.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function isValidPin(pin) {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

function hashPin(pin) {
  return bcrypt.hash(pin, 10);
}

function comparePin(pin, hash) {
  return bcrypt.compare(pin, hash);
}

/** Is this teacher document currently locked out of PIN attempts? */
function isLockedOut(teacher) {
  return !!(teacher.pinLockedUntil && new Date(teacher.pinLockedUntil).getTime() > Date.now());
}

module.exports = {
  PIN_PATTERN,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
  isValidPin,
  hashPin,
  comparePin,
  isLockedOut
};
