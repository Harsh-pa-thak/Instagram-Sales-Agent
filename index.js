// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json());
app.use(cors());
const port = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Main Route ---
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// --- API Endpoints ---

// GET all posts for the dashboard
app.get('/api/posts', async (req, res) => {
  try {
    const sql = 'SELECT * FROM instagram_posts ORDER BY created_at DESC';
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (error) {
    console.error('Database error fetching posts:', error);
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// ADD a new post (from Make.com)
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  try {
    const sql = 'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(sql, [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error creating post:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// GET all scraped leads for the dashboard
app.get('/api/leads', async (req, res) => {
    try {
        const sql = 'SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC';
        const result = await pool.query(sql);
        res.json(result.rows);
    } catch (error) {
        console.error('Database error fetching leads:', error);
        res.status(500).send({ error: 'Failed to fetch leads.' });
    }
});

// --- NEW WEBHOOK ENDPOINT FOR PHANTOM BUSTER ---
// This endpoint will receive the scraped leads directly from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  const leads = req.body; // Phantom Buster sends an array of lead objects
  console.log(`Received ${leads.length} leads from Phantom Buster webhook.`);

  if (!leads || !Array.isArray(leads)) {
    return res.status(400).send('Invalid data format.');
  }

  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl;
      if (username && profileUrl) {
        const sql = 'INSERT INTO instagram_agent_leads (username, profile_url) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING';
        await pool.query(sql, [username, profileUrl]);
      }
    }
    console.log('Successfully saved leads to the database.');
    res.status(200).send('Webhook received and leads processed.');
  } catch (error) {
    console.error('Database error during webhook import:', error);
    res.status(500).send('Error processing webhook data.');
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
