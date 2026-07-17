const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM familias WHERE activo = 1 ORDER BY nombre').all();
  res.json(rows);
});

module.exports = router;
