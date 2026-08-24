const express = require('express');
const Admin = require('../models/Admin');
const { COOKIE_NAME, signToken, cookieOptions } = require('../utils/jwt');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const admin = await Admin.findOne({ username });
    const ok = admin && (await admin.checkPassword(password));
    if (!ok) {
      // Same message either way — don't reveal whether the username exists.
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }

    const token = signToken(admin);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ admin: { id: admin._id, username: admin.username, name: admin.name } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin });
});

/** Create another admin account. Requires an existing admin session —
 *  there is no public self-registration endpoint. */
router.post('/admins', requireAdmin, async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    if (!username || !name || !password) {
      return res.status(400).json({ error: 'Username, name and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const passwordHash = await Admin.hashPassword(password);
    const admin = await Admin.create({ username, name, passwordHash });
    res.status(201).json({ admin: { id: admin._id, username: admin.username, name: admin.name } });
  } catch (err) {
    next(err);
  }
});

router.post('/change-password', requireAdmin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const admin = await Admin.findById(req.admin.id);
    if (!(await admin.checkPassword(currentPassword))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    admin.passwordHash = await Admin.hashPassword(newPassword);
    await admin.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
