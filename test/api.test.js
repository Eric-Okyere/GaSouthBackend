process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.NODE_ENV = 'test';
process.env.FLAG_DISTANCE_METERS = '300';
process.env.STORE_PRECISE_LOCATION = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');

const { installFakes } = require('./support/installFakes');
const fakes = installFakes();

const { createApp } = require('../src/app');
const supertest = require('supertest');

const app = createApp();

async function loginAgent(username = 'admin', password = 'secret123') {
  const agent = supertest.agent(app);
  const res = await agent.post('/api/admin/auth/login').send({ username, password });
  assert.equal(res.status, 200, 'login should succeed: ' + JSON.stringify(res.body));
  return agent;
}

test.before(async () => {
  await fakes.Admin.create({
    username: 'admin',
    name: 'Test Admin',
    passwordHash: await fakes.Admin.hashPassword('secret123')
  });
});

test('rejects bad login credentials', async () => {
  const res = await supertest(app).post('/api/admin/auth/login').send({ username: 'admin', password: 'wrong' });
  assert.equal(res.status, 401);
});

test('accepts correct login and /me works with the cookie', async () => {
  const agent = await loginAgent();
  const me = await agent.get('/api/admin/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.admin.username, 'admin');
});

test('admin routes reject requests with no session', async () => {
  const res = await supertest(app).get('/api/admin/schools');
  assert.equal(res.status, 401);
});

let schoolId;
test('admin can create a school, and it shows up in the public directory', async () => {
  const agent = await loginAgent();
  const created = await agent.post('/api/admin/schools').send({ name: 'Test Pilot Basic School' });
  assert.equal(created.status, 201);
  schoolId = created.body.id;

  const publicList = await supertest(app).get('/api/schools');
  assert.equal(publicList.status, 200);
  assert.ok(publicList.body.some((s) => s.id === schoolId));
});

test('admin can set a GPS anchor for the school', async () => {
  const agent = await loginAgent();
  const res = await agent.post(`/api/admin/schools/${schoolId}/anchor`).send({ lat: 5.6037, lng: -0.187 });
  assert.equal(res.status, 200);
  assert.equal(res.body.anchorLat, 5.6037);
});

let teacherStaffId;
test('admin can add a roster entry for the school', async () => {
  const agent = await loginAgent();
  const res = await agent.post(`/api/admin/schools/${schoolId}/teachers`).send({ staffId: 'ges-001', name: 'Comfort Ansah' });
  assert.equal(res.status, 201);
  assert.equal(res.body.staffId, 'GES-001'); // normalized uppercase
  teacherStaffId = res.body.staffId;
});

test('duplicate staff ID at the same school is rejected', async () => {
  const agent = await loginAgent();
  const res = await agent.post(`/api/admin/schools/${schoolId}/teachers`).send({ staffId: 'GES-001', name: 'Someone Else' });
  assert.equal(res.status, 409);
});

test('status lookup for a rostered staff ID returns their verified name and next=in', async () => {
  const res = await supertest(app).get(`/api/schools/${schoolId}/status`).query({ staffId: teacherStaffId });
  assert.equal(res.status, 200);
  assert.equal(res.body.verifiedName, 'Comfort Ansah');
  assert.equal(res.body.next, 'in');
});

test('check-in for a rostered teacher: verified, uses roster name, no name needed in body', async () => {
  const res = await supertest(app).post(`/api/schools/${schoolId}/attendance`).send({ staffId: teacherStaffId });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'in');
  assert.equal(res.body.verified, true);
  assert.equal(res.body.name, 'Comfort Ansah');
});

test('second call the same day is a check-out', async () => {
  const res = await supertest(app).post(`/api/schools/${schoolId}/attendance`).send({ staffId: teacherStaffId });
  assert.equal(res.status, 201);
  assert.equal(res.body.type, 'out');
});

test('a third call the same day is rejected as already complete', async () => {
  const res = await supertest(app).post(`/api/schools/${schoolId}/attendance`).send({ staffId: teacherStaffId });
  assert.equal(res.status, 409);
  assert.ok(res.body.checkedInAt && res.body.checkedOutAt);
});

test('unverified staff ID requires a typed name', async () => {
  const noName = await supertest(app).post(`/api/schools/${schoolId}/attendance`).send({ staffId: 'GES-999' });
  assert.equal(noName.status, 400);

  const withName = await supertest(app)
    .post(`/api/schools/${schoolId}/attendance`)
    .send({ staffId: 'GES-999', name: 'Kwame Mensah' });
  assert.equal(withName.status, 201);
  assert.equal(withName.body.verified, false);
  assert.equal(withName.body.name, 'Kwame Mensah');
});

test('a check-in far from the anchored GPS point is flagged, but still recorded', async () => {
  // School anchor is at 5.6037,-0.187 (Accra). Send a point ~5km away.
  const res = await supertest(app)
    .post(`/api/schools/${schoolId}/attendance`)
    .send({ staffId: 'GES-555', name: 'Ama Owusu', lat: 5.65, lng: -0.187 });
  assert.equal(res.status, 201);
  assert.equal(res.body.flagged, true);
  assert.ok(res.body.distanceM > 300);
});

test('admin records list reflects everything recorded, and can be filtered by school', async () => {
  const agent = await loginAgent();
  const res = await agent.get('/api/admin/records').query({ school: schoolId });
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 4); // in, out, unverified in, flagged in
});

test('admin can delete a record', async () => {
  const agent = await loginAgent();
  // Create a disposable record rather than deleting one earlier tests still
  // rely on, so later assertions (stats, export) see a stable count.
  const throwaway = await supertest(app)
    .post(`/api/schools/${schoolId}/attendance`)
    .send({ staffId: 'GES-DELETE-ME', name: 'Disposable Person' });
  assert.equal(throwaway.status, 201);

  const list = await agent.get('/api/admin/records').query({ school: schoolId, pageSize: 1 });
  const id = list.body.records[0].id; // most recent = the one just created
  const del = await agent.delete(`/api/admin/records/${id}`);
  assert.equal(del.status, 200);

  const after = await agent.get(`/api/schools/${schoolId}/status`).query({ staffId: 'GES-DELETE-ME' });
  assert.equal(after.body.next, 'in'); // deletion actually removed it
});

test('CSV export contains a header row and data', async () => {
  const agent = await loginAgent();
  const res = await agent.get('/api/admin/records/export').query({ school: schoolId });
  assert.equal(res.status, 200);
  assert.match(res.text, /^Date,Time,School,Teacher Name,Staff ID,Type,Verified,Distance \(m\),Flagged/);
  assert.ok(res.text.split('\r\n').length > 1);
});

test('bulk teacher import creates and updates roster entries', async () => {
  const agent = await loginAgent();
  const res = await agent.post(`/api/admin/schools/${schoolId}/teachers/bulk`).send({
    rows: [
      { staffId: 'GES-001', name: 'Comfort Ansah (updated)' }, // existing -> update
      { staffId: 'GES-777', name: 'New Teacher' }, // new -> create
      { staffId: '', name: 'Missing ID' } // invalid -> skipped
    ]
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.updated, 1);
  assert.equal(res.body.skipped.length, 1);
});

test('today stats aggregate check-ins/outs and flags across schools', async () => {
  const agent = await loginAgent();
  const res = await agent.get('/api/admin/stats/today');
  assert.equal(res.status, 200);
  assert.ok(res.body.checkins >= 3);
  assert.ok(res.body.flagged >= 1);
  assert.ok(res.body.perSchool.some((s) => s.schoolId === schoolId));
});

test('admin can change their own password, and the old one stops working', async () => {
  const agent = await loginAgent();
  const change = await agent.post('/api/admin/auth/change-password').send({ currentPassword: 'secret123', newPassword: 'newpassword456' });
  assert.equal(change.status, 200);

  const oldLogin = await supertest(app).post('/api/admin/auth/login').send({ username: 'admin', password: 'secret123' });
  assert.equal(oldLogin.status, 401);

  const newLogin = await supertest(app).post('/api/admin/auth/login').send({ username: 'admin', password: 'newpassword456' });
  assert.equal(newLogin.status, 200);
});

test('logout clears the session', async () => {
  const agent = await loginAgent('admin', 'newpassword456');
  const out = await agent.post('/api/admin/auth/logout');
  assert.equal(out.status, 200);
  const me = await agent.get('/api/admin/auth/me');
  assert.equal(me.status, 401);
});
