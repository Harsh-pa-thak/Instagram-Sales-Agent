// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// --- App & Middleware Setup ---
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const port = process.env.PORT || 3000;

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Main Route ---
app.get('/', (req, res) => res.send('Server is running!'));

// --- API Endpoints ---

// GET all posts
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM instagram_posts ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// GET all scraped leads
app.get('/api/leads', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch leads.' });
  }
});

// ADD a new post (from Make.com or frontend)
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url)
    return res.status(400).send({ error: 'Post URL is required.' });

  try {
    const result = await pool.query(
      'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *',
      [post_url, post_date]
    );
    res
      .status(201)
      .send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// TRIGGER a Phantom Buster scrape
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url)
    return res.status(400).send({ error: 'Post URL is required.' });

  try {
    const PHANTOM_ID = '2487161782151911'; // Replace with your Phantom ID
    const PHANTOM_BUSTER_API_KEY = process.env.PHANTOM_BUSTER_API_KEY;

    if (!PHANTOM_BUSTER_API_KEY)
      throw new Error('Phantom Buster API key is not configured.');

    const endpoint = `https://api.phantombuster.com/api/v2/phantoms/${PHANTOM_ID}/launch`;
    const payload = { argument: { postUrls: [post_url] } };
    const headers = { 'X-Phantombuster-Key': PHANTOM_BUSTER_API_KEY };

    await axios.post(endpoint, payload, { headers });
    res
      .status(200)
      .send({ message: `Scraping job started for ${post_url}.` });
  } catch (error) {
    console.error(
      'Error launching Phantom Buster:',
      error.response ? error.response.data : error.message
    );
    res.status(500).send({ error: 'Failed to launch Phantom Buster job.' });
  }
});

// --- WEBHOOK ENDPOINT ---
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');

  const webhookPayload = req.body;
  let leads = [];

  // Detect where the leads array is inside the payload
  if (Array.isArray(webhookPayload)) {
    leads = webhookPayload;
  } else if (webhookPayload && Array.isArray(webhookPayload.resultObject)) {
    leads = webhookPayload.resultObject;
  } else {
    console.log('Webhook payload did not contain a recognizable array of leads.');
  }

  if (leads.length === 0) {
    return res
      .status(200)
      .send('Webhook received, but contained no leads to process.');
  }

  console.log(`Processing ${leads.length} leads from webhook.`);

  try {
    let savedCount = 0;
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl =
        lead.profileUrl || lead.profile_url || lead.profileLink;

      if (username && profileUrl) {
        const sql =
          'INSERT INTO instagram_agent_leads (username, profile_url) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING';
        const result = await pool.query(sql, [username, profileUrl]);
        if (result.rowCount > 0) {
          savedCount++;
        }
      }
    }
    console.log(`Successfully saved ${savedCount} new leads to the database.`);
    res.status(200).send('Webhook received and leads processed.');
  } catch (error) {
    console.error('Database error during webhook import:', error);
    res.status(500).send('Error processing webhook data.');
  }
});

// Start the server
app.listen(port, () =>
  console.log(`Server is listening on port ${port}`)
);
