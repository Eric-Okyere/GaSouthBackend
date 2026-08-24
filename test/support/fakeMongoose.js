/**
 * A tiny in-memory stand-in for the four Mongoose models, used ONLY by the
 * test suite. Real Mongoose/MongoDB is unavailable in this sandbox (no
 * network egress to fastdl.mongodb.org to fetch a local mongod, and no
 * Docker daemon), so this shim lets the actual route logic — the part that
 * matters — run against something DB-shaped instead of going untested.
 * It is not shipped; nothing in src/ references it. Swap it for a real
 * MongoDB (see README) and the same routes run unchanged.
 *
 * It implements just the subset of the Mongoose query API the routes
 * actually call: find/findOne/findById/findByIdAndUpdate/findByIdAndDelete/
 * findOneAndUpdate/create/insertMany/countDocuments/exists/deleteMany, with
 * chainable sort/skip/limit/select/populate/lean.
 */
const crypto = require('crypto');

function genId() {
  return crypto.randomBytes(12).toString('hex');
}
function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('$gte' in v || '$lte' in v || '$in' in v)) {
      const val = getPath(doc, k);
      if ('$gte' in v && !(val >= v.$gte)) return false;
      if ('$lte' in v && !(val <= v.$lte)) return false;
      if ('$in' in v && !v.$in.some((x) => String(x) === String(val))) return false;
      return true;
    }
    return String(getPath(doc, k)) === String(v);
  });
}
function applySort(docs, sort) {
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = getPath(a, key);
      const bv = getPath(b, key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}
function applySelect(doc, select) {
  if (!doc || !select) return doc;
  const fields = select.split(/\s+/).filter(Boolean);
  const out = { _id: doc._id };
  for (const f of fields) out[f] = doc[f];
  return out;
}

class FakeQuery {
  constructor(run) {
    this._run = run;
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._select = null;
    this._populate = null;
    this._lean = false;
  }
  sort(s) { this._sort = s; return this; }
  skip(n) { this._skip = n; return this; }
  limit(n) { this._limit = n; return this; }
  select(s) { this._select = s; return this; }
  populate(field, select) { this._populate = { field, select }; return this; }
  lean() { this._lean = true; return this; }
  then(onRes, onRej) { return this._run(this).then(onRes, onRej); }
  catch(onRej) { return this._run(this).catch(onRej); }
}

/** Creates an in-memory model. `refs`: { fieldName: otherModel } for populate().
 *  `uniqueKeys`: array of field-name arrays that must be unique together,
 *  mirroring the compound unique indexes declared on the real models. */
function createFakeModel(name, { refs = {}, uniqueKeys = [], defaults = {} } = {}) {
  const store = [];

  function assertUnique(doc, ignoreId) {
    for (const keys of uniqueKeys) {
      const clash = store.some(
        (d) =>
          String(d._id) !== String(ignoreId) &&
          keys.every((k) => String(d[k]) === String(doc[k]))
      );
      if (clash) {
        const err = new Error(`duplicate key: ${keys.join('+')}`);
        err.code = 11000;
        throw err;
      }
    }
  }

  function finalize(query, doc) {
    if (!doc) return doc;
    let out = query._lean ? clone(doc) : doc;
    if (query._populate) {
      const { field, select } = query._populate;
      const ref = refs[field];
      const raw = out[field];
      const found = ref && raw != null ? ref.__store().find((d) => String(d._id) === String(raw)) : null;
      out = { ...out, [field]: found ? applySelect(clone(found), select) : null };
    }
    if (query._select) out = applySelect(out, query._select);
    return out;
  }

  const Model = {
    __store: () => store,

    find(filter = {}) {
      return new FakeQuery(async (q) => {
        let docs = store.filter((d) => matchesFilter(d, filter));
        if (q._sort) docs = applySort(docs, q._sort);
        if (q._skip) docs = docs.slice(q._skip);
        if (q._limit != null) docs = docs.slice(0, q._limit);
        return docs.map((d) => finalize(q, d));
      });
    },
    findOne(filter = {}) {
      return new FakeQuery(async (q) => {
        let docs = store.filter((d) => matchesFilter(d, filter));
        if (q._sort) docs = applySort(docs, q._sort);
        return finalize(q, docs[0] || null);
      });
    },
    findById(id) {
      return Model.findOne({ _id: id });
    },
    async create(data) {
      const doc = { _id: genId(), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data };
      assertUnique(doc);
      store.push(doc);
      return doc;
    },
    async insertMany(arr) {
      const docs = arr.map((data) => ({ _id: genId(), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...data }));
      store.push(...docs);
      return docs;
    },
    findByIdAndUpdate(id, update, opts = {}) {
      return new FakeQuery(async (q) => {
        const doc = store.find((d) => String(d._id) === String(id));
        if (!doc) return null;
        const merged = { ...doc, ...update };
        assertUnique(merged, doc._id);
        Object.assign(doc, update, { updatedAt: new Date() });
        return finalize(q, doc);
      });
    },
    findByIdAndDelete(id) {
      return new FakeQuery(async (q) => {
        const idx = store.findIndex((d) => String(d._id) === String(id));
        if (idx === -1) return null;
        const [doc] = store.splice(idx, 1);
        return finalize(q, doc);
      });
    },
    async findOneAndUpdate(filter, update, opts = {}) {
      let doc = store.find((d) => matchesFilter(d, filter));
      let upserted = null;
      if (!doc && opts.upsert) {
        doc = { _id: genId(), createdAt: new Date(), updatedAt: new Date(), ...defaults, ...filter, ...update };
        store.push(doc);
        upserted = doc._id;
      } else if (doc) {
        Object.assign(doc, update, { updatedAt: new Date() });
      } else {
        return opts.rawResult ? { value: null, lastErrorObject: {} } : null;
      }
      if (opts.rawResult) return { value: clone(doc), lastErrorObject: { upserted } };
      return opts.new === false ? clone(doc) : clone(doc);
    },
    countDocuments(filter = {}) {
      return Promise.resolve(store.filter((d) => matchesFilter(d, filter)).length);
    },
    exists(filter = {}) {
      return Promise.resolve(store.some((d) => matchesFilter(d, filter)) ? { _id: 'x' } : null);
    },
    deleteMany(filter = {}) {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) {
        if (matchesFilter(store[i], filter)) store.splice(i, 1);
      }
      return Promise.resolve({ deletedCount: before - store.length });
    },
    __reset() { store.length = 0; },
  };

  return Model;
}

module.exports = { createFakeModel, genId };
