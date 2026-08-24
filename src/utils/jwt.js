const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'gsta_token';

function signToken(admin) {
  return jwt.sign(
    { sub: admin._id.toString(), username: admin.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000
  };
}

module.exports = { COOKIE_NAME, signToken, verifyToken, cookieOptions };
