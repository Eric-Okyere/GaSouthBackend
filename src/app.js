const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const publicRoutes = require('./routes/public');
const registrationRoutes = require('./routes/registration');
const adminAuthRoutes = require('./routes/adminAuth');
const adminRoutes = require('./routes/admin');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.set('trust proxy', 1); // running behind nginx/another reverse proxy

  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    helmet({
      // The API serves JSON only; a strict default CSP has no upside here
      // and can interfere with tooling. The frontend app sets its own.
      contentSecurityPolicy: false
    })
  );
  app.use(
    cors({
      origin: allowedOrigins.length ? allowedOrigins : false,
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a while and try again.' }
  });
  app.use('/api/admin/auth/login', loginLimiter);

  const attendanceLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' }
  });
  app.use('/api/schools/:id/attendance', attendanceLimiter);

  const registerLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' }
  });
  app.use('/api/register', registerLimiter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', publicRoutes);
  app.use('/api', registrationRoutes);
  app.use('/api/admin/auth', adminAuthRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
