// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis'); // For connecting to Google Sheets
const cors = require('cors');
require('dotenv').config(); // To read secret keys from the environment

// --- App & Middleware Setup ---
const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing for your frontend
app.use(express.json()); // Enable the express app to parse JSON formatted request bodies
const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Neon or Render PostgreSQL
  }
});

// --- Root Route ---
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// --- API Endpoints for Dashboard ---

// Get all posts
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

// Get all leads
app.get('/api/leads', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Database error fetching leads:', error);
    res.status(500).send({ error: 'Failed to fetch leads.' });
  }
});

// --- Automation Endpoints ---

// Add a new post
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  try {
    const result = await pool.query(
      'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *',
      [post_url, post_date]
    );
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error creating post:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// Trigger scraping (adds post URL to Google Sheet)
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required.' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

    // Clear old URLs
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:A',
    });

    // Add new post URL
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[post_url]],
      },
    });

    res.status(200).send({ message: 'Post URL has been sent to the scraping queue.' });
  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    res.status(500).send({ error: 'Failed to update Google Sheet.' });
  }
});

// Webhook endpoint for Phantom Buster leads
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');

  let leads = [];
  let rawBody = req.body;

  if (typeof rawBody === 'string') {
    try {
      rawBody = JSON.parse(rawBody);
    } catch (e) {
      console.error('Webhook body is a non-JSON string, cannot parse.');
      return res.status(400).send('Invalid data format: Not valid JSON.');
    }
  }

  if (Array.isArray(rawBody)) {
    leads = rawBody;
  } else if (rawBody && Array.isArray(rawBody.resultObject)) {
    leads = rawBody.resultObject;
  }

  if (leads.length === 0) {
    return res.status(200).send('Webhook received, but contained no leads to process.');
  }

  console.log(`Processing ${leads.length} leads from webhook.`);

  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl || lead.profile_url || lead.profileLink;

      if (username && profileUrl) {
        const sql = `
          INSERT INTO instagram_agent_leads (username, profile_url) 
          VALUES ($1, $2) 
          ON CONFLICT (username) DO NOTHING
        `;
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

// --- Start the Server ---
app.listen(port, () => console.log(`Server is listening on port ${port}`));
