require('dotenv').config();
const { connectDB } = require('./config/db');
const { createApp } = require('./app');
const cors = require("cors");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set — copy .env to .env first.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set — copy .env to .env first.');

  await connectDB(process.env.MONGODB_URI);

  const app = createApp();
  const port = process.env.PORT || 4001;

  const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, callback) {
        // Allow no-origin requests (curl, server-to-server, health checks).
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
    })
  );



  app.listen(port, () => {
    console.log(`[server] Ga South Attendance API listening on :${port}`);
  });
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
