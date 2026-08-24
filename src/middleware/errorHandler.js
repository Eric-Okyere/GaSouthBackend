function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);

  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ error: Object.values(err.errors).map((e) => e.message).join(' ') });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ error: 'That already exists.' });
  }
  if (err && err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid id.' });
  }

  res.status(err.status || 500).json({ error: err.publicMessage || 'Something went wrong.' });
}

module.exports = { notFound, errorHandler };
