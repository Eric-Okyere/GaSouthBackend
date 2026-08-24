/**
 * Swaps the four real Mongoose models (src/models/*.js) for the in-memory
 * fakes in fakeMongoose.js, by pre-populating Node's require cache before
 * anything else requires those paths. Call installFakes() before requiring
 * src/app.js (directly or via any route file) in a test.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { createFakeModel } = require('./fakeMongoose');

function resolveModelPath(name) {
  return require.resolve(path.join(__dirname, '../../src/models', name));
}

function installFakes() {
  const School = createFakeModel('School', {
    defaults: { active: true, anchorLat: null, anchorLng: null, anchorSetAt: null }
  });
  const Teacher = createFakeModel('Teacher', {
    refs: { school: School },
    uniqueKeys: [['school', 'staffId']],
    defaults: { active: true }
  });
  const Attendance = createFakeModel('Attendance', {
    refs: { school: School, teacher: Teacher },
    uniqueKeys: [['school', 'staffId', 'type', 'dateKey']],
    defaults: { teacher: null, verified: false, distanceM: null, flagged: false, lat: null, lng: null }
  });
  const Admin = createFakeModel('Admin', { uniqueKeys: [['username']] });

  Admin.hashPassword = (pw) => bcrypt.hash(pw, 4); // low cost factor: tests only
  const realCreate = Admin.create;
  Admin.create = async (data) => {
    const doc = await realCreate(data);
    attachAdminMethods(doc);
    return doc;
  };
  function attachAdminMethods(doc) {
    doc.checkPassword = (pw) => bcrypt.compare(pw, doc.passwordHash);
    doc.save = async () => doc; // fields are mutated in place on the store object already
    return doc;
  }

  const fakes = { School, Teacher, Attendance, Admin };
  for (const [name, fake] of Object.entries(fakes)) {
    const resolved = resolveModelPath(name);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: fake
    };
  }
  return fakes;
}

module.exports = { installFakes };
