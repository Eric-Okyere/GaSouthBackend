const mongoose = require('mongoose');

// A school's teacher roster. Optional in the sense that check-in still works
// for a staff ID with no roster entry (recorded as "unverified"), but a
// roster entry lets the server confirm the teacher's real name instead of
// trusting whatever was typed, and lets an admin see who hasn't shown up.
const teacherSchema = new mongoose.Schema(
  {
    school: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    staffId: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// A staff ID only needs to be unique within its own school.
teacherSchema.index({ school: 1, staffId: 1 }, { unique: true });

module.exports = mongoose.model('Teacher', teacherSchema);
