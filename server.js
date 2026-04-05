const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors()); // Allows your game to talk to this server
app.use(express.json()); // Allows server to read JSON data

// Connect to Neon Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ROUTE 1: Get the Top 10 High Scores
app.get('/leaderboard', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT name, score FROM leaderboard ORDER BY score DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ROUTE 2: Save a New Score
app.post('/leaderboard', async (req, res) => {
  const { name, score } = req.body;
  try {
    await pool.query(
      'INSERT INTO leaderboard (name, score) VALUES ($1, $2)',
      [name.substring(0, 7), Math.floor(score)]
    );
    res.status(201).json({ message: "Score saved!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save score" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
