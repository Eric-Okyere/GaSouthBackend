const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // GPS anchor: set once by an admin standing at the school. Null until captured.
    anchorLat: { type: Number, default: null },
    anchorLng: { type: Number, default: null },
    anchorSetAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    // Short, typeable stand-in for the QR/check-in link (see utils/schoolCode.js).
    // No `default` on purpose: leaving the path unset for schools created before
    // this feature is what lets the sparse unique index below tolerate many
    // schools without one at once — they're backfilled lazily on read.
    code: { type: String, uppercase: true, trim: true, unique: true, sparse: true }
  },
  { timestamps: true }
);

schoolSchema.index({ name: 1 });

module.exports = mongoose.model('School', schoolSchema);
