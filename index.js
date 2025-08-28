// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config(); // <-- 1. ADD THIS LINE AT THE TOP

// Create the Express app
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
const port = 3000;

// Database connection pool
const pool = new Pool({
  // Use the DATABASE_URL from the Render environment
  connectionString: process.env.DATABASE_URL,
  // Add SSL configuration for connecting to Neon
  ssl: { // <-- 2. ADD THIS SSL OBJECT
    rejectUnauthorized: false
  }
});

// Test route
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// API endpoint to add a new post
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required.' });
  }

  console.log('Received request to add post:', post_url);
  try {
    const sql = 'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(sql, [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});