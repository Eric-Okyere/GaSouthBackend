const { COOKIE_NAME, verifyToken } = require('../utils/jwt');
const Admin = require('../models/Admin');

/** Requires a valid admin session cookie; attaches req.admin (lean doc, no hash). */
async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not signed in.' });

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }

    const admin = await Admin.findById(payload.sub).lean();
    if (!admin) return res.status(401).json({ error: 'Account no longer exists.' });

    req.admin = { id: admin._id.toString(), username: admin.username, name: admin.name };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAdmin };
