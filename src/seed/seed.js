/**
 * One-time bootstrap: run with `npm run seed` after setting up your .env.
 * - Creates the first admin account (from SEED_ADMIN_* env vars), if none exists.
 * - Loads the starter school list (from schools.json), skipping any school
 *   name that already exists so this is safe to re-run.
 *
 * This is a *starter* list pulled from partial spreadsheet screenshots the
 * district provided — not the full Ga South roster. Add/rename/remove
 * schools afterwards from the admin dashboard.
 */
require('dotenv').config();
const { connectDB } = require('../config/db');
const School = require('../models/School');
const Admin = require('../models/Admin');
const schoolNames = require('./schools.json');

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — copy .env.example to .env first.');
  await connectDB(process.env.MONGODB_URI);

  // --- schools ---
  const existing = new Set((await School.find().select('name').lean()).map((s) => s.name));
  const toInsert = schoolNames.filter((n) => !existing.has(n)).map((name) => ({ name }));
  if (toInsert.length) {
    await School.insertMany(toInsert);
    console.log(`[seed] added ${toInsert.length} school(s)`);
  } else {
    console.log('[seed] schools already present, skipped');
  }

  // --- first admin ---
  const adminCount = await Admin.countDocuments();
  if (adminCount === 0) {
    const username = process.env.SEED_ADMIN_USERNAME;
    const password = process.env.SEED_ADMIN_PASSWORD;
    const name = process.env.SEED_ADMIN_NAME || 'District Admin';
    if (!username || !password) {
      throw new Error('SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD must be set in .env to create the first admin.');
    }
    const passwordHash = await Admin.hashPassword(password);
    await Admin.create({ username: username.toLowerCase().trim(), name, passwordHash });
    console.log(`[seed] created admin "${username}" — change this password after first login.`);
  } else {
    console.log('[seed] an admin already exists, skipped');
  }

  console.log('[seed] done.');
  process.exit(0);
}

run().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
