const crypto = require('crypto');

// Device binding is the anti-impersonation control: a staff ID printed on a
// school's public QR flyer isn't secret, so typing it can't prove who's
// actually standing there. A browser generates a random token once and
// stores it (frontend/src/lib/device.ts); the first check-in for a staff ID
// binds that token to it, and every check-in/out after that must come from
// the same browser or it's rejected outright (see routes/public.js).
//
// This is NOT a hardware device ID — the web has no access to one. It's
// just a value in localStorage, so a teacher who gets a new phone, clears
// their browser data, or uses private browsing will need an admin to reset
// their device (see the admin reset-device route) before they can check in
// again. Only the hash is ever stored, never the token itself.

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = { hashDeviceToken };
