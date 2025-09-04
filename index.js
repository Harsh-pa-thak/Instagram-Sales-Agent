// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json());
app.use(cors());
const port = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Main Route ---
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// --- API Endpoints ---

// GET all posts for the dashboard
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM instagram_posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// GET all scraped leads for the dashboard
app.get('/api/leads', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch leads.' });
    }
});

// ADD a new post (from Make.com)
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  try {
    const result = await pool.query('INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *', [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// TRIGGER a Phantom Buster scrape (Manual approach, can be removed if not used)
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  // This endpoint is part of a manual trigger flow and may be deprecated
  // in favor of the fully automated webhook flow.
  res.status(200).send({ message: `Manual scrape trigger is set up but webhook is preferred.` });
});


// --- UPGRADED WEBHOOK ENDPOINT to receive leads from Phantom Buster ---
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  console.log('Raw req.body:', JSON.stringify(req.body, null, 2));

  // Phantom Buster sometimes nests the result in a "resultObject" or other properties.
  // This code will intelligently find the array of leads.
  let leads = [];
  if (Array.isArray(req.body)) {
    leads = req.body;
  } else if (req.body && Array.isArray(req.body.resultObject)) {
    leads = req.body.resultObject;
  }

  if (leads.length === 0) {
    console.log('Webhook received but contained no leads to process.');
    return res.status(200).send('Webhook received, no leads to process.');
  }
  
  console.log(`Processing ${leads.length} leads from webhook.`);
  
  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl;
      // Ensure we have the necessary data before trying to insert
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
app.listen(port, () => console.log(`Server is listening on port ${port}`));

