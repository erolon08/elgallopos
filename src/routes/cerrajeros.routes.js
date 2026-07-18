const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM cerrajeros WHERE activo = 1 ORDER BY nombre').all());
});

module.exports = router;
