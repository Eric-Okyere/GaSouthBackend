const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // GPS anchor: set once by an admin standing at the school. Null until captured.
    anchorLat: { type: Number, default: null },
    anchorLng: { type: Number, default: null },
    anchorSetAt: { type: Date, default: null },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

schoolSchema.index({ name: 1 });

module.exports = mongoose.model('School', schoolSchema);
