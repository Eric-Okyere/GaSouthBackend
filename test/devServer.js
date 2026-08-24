// Starts a real HTTP server backed by the in-memory fake models, seeded with
// one school and one admin — used only to smoke-test the Next.js rewrite
// proxy end-to-end (cookies, CORS-free same-origin flow) without a real
// MongoDB. Not part of the shipped app.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-smoke-test-secret';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.PORT = process.env.PORT || '4000';

const { installFakes } = require('./support/installFakes');
const fakes = installFakes();

const { createApp } = require('../src/app');

(async () => {
  const school = await fakes.School.create({ name: 'Smoke Test Basic School' });
  await fakes.Admin.create({
    username: 'admin',
    name: 'Smoke Admin',
    passwordHash: await fakes.Admin.hashPassword('smoketest123')
  });
  console.log('[dev-server] seeded school id:', school._id);

  const app = createApp();
  app.listen(process.env.PORT, () => {
    console.log(`[dev-server] listening on :${process.env.PORT}`);
  });
})();
