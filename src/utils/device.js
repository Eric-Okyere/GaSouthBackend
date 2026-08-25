const crypto = require('crypto');

// A soft "recognized device" signal, layered on top of the PIN. A PIN alone
// can be read aloud over a phone call and typed into someone else's device;
// this makes that specific shortcut visible (not blocked — see below) by
// remembering which browsers a staff ID's PIN has actually succeeded from.
//
// This is NOT a hardware device ID — the web has no access to one. It's a
// random token the browser generates once and stores in localStorage, sent
// with every check-in/out. That means it's inherently soft: private
// browsing, "clear site data," or a new phone all legitimately reset it.
// That's exactly why a mismatch only ever *flags* a record for admin
// review — it never blocks the check-in/out itself.

const MAX_DEVICES_PER_TEACHER = 5;

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Folds one check-in's device token into a teacher's known-device list.
 * Returns { deviceTokens, newDevice } — the updated list to persist, and
 * whether this token was unrecognized (only meaningful once at least one
 * device was already known; a teacher's very first device is never "new",
 * there's nothing yet to differ from).
 */
function recognizeDevice(existingTokens, token) {
  const known = Array.isArray(existingTokens) ? [...existingTokens] : [];
  if (!token) return { deviceTokens: known, newDevice: false };

  const tokenHash = hashDeviceToken(token);
  const idx = known.findIndex((d) => d.tokenHash === tokenHash);
  const now = new Date();

  if (idx >= 0) {
    known[idx] = { ...known[idx], lastSeenAt: now };
    return { deviceTokens: known, newDevice: false };
  }

  const newDevice = known.length > 0;
  known.push({ tokenHash, firstSeenAt: now, lastSeenAt: now });
  while (known.length > MAX_DEVICES_PER_TEACHER) known.shift(); // forget the oldest, not the newest
  return { deviceTokens: known, newDevice };
}

module.exports = { hashDeviceToken, recognizeDevice, MAX_DEVICES_PER_TEACHER };
