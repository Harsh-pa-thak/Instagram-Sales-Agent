// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis');
const cors = require('cors');
require('dotenv').config();

// --- App & Middleware Setup ---
const app = express();
app.use(cors());
// We will use a raw body parser to capture the data before anything else touches it
app.use(express.raw({ type: '*/*', limit: '50mb' }));

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
    const result = await pool.query('SELECT * FROM instagram_posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// GET all scraped leads
app.get('/api/leads', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch leads.' });
    }
});

// ADD a new post (from Make.com)
app.post('/api/posts', express.json(), async (req, res) => { // Add json parser just for this route
  const { post_url, post_date } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  try {
    const result = await pool.query('INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *', [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// TRIGGER: Adds a post URL to the Google Sheet
app.post('/api/scrape', express.json(), async (req, res) => { // Add json parser just for this route
  const { post_url } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: 'A2:A' });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[post_url]] },
    });
    
    res.status(200).send({ message: `Post URL has been sent to the scraping queue.` });
  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    res.status(500).send({ error: 'Failed to update Google Sheet.' });
  }
});

// WEBHOOK ENDPOINT to receive leads from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  
  // --- NEW SUPER-DEBUGGING LOGS ---
  console.log('Webhook Headers:', JSON.stringify(req.headers, null, 2));
  const rawBody = req.body.toString('utf8');
  console.log('Raw Webhook Body:', rawBody);
  // --- END DEBUGGING LOGS ---

  let leads = [];
  try {
    const data = JSON.parse(rawBody);
    if (Array.isArray(data)) {
      leads = data;
    } else if (data && Array.isArray(data.resultObject)) {
      leads = data.resultObject;
    }
  } catch (e) {
      console.error('Could not parse raw body as JSON:', e.message);
      return res.status(400).send('Invalid JSON format.');
  }

  if (leads.length === 0) {
    return res.status(200).send('Webhook received, no leads to process.');
  }
  
  console.log(`Processing ${leads.length} leads from webhook.`);
  
  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl || lead.profile_url || lead.profileLink;
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

