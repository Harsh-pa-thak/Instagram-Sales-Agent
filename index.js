// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis'); // For connecting to Google Sheets
const cors = require('cors');
require('dotenv').config(); // To read secret keys from the environment

// --- App & Middleware Setup ---
const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing for your frontend
// Use multiple body parsers to handle different webhook formats from Phantom Buster
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Main Route ---
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// --- API Endpoints for the Dashboard ---

// GET all posts
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM instagram_posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Database error fetching posts:', error);
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// GET all scraped leads
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

// ADD a new post (from Make.com)
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });
  try {
    const result = await pool.query('INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *', [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error creating post:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// TRIGGER: Adds a post URL to the Google Sheet AND records the active job
app.post('/api/scrape', async (req, res) => {
  const { post_url, post_id } = req.body;
  if (!post_url || !post_id) {
    return res.status(400).send({ error: 'Post URL and Post ID are required.' });
  }

  try {
    // Record the active job in our database
    await pool.query('DELETE FROM active_scrape_job');
    await pool.query('INSERT INTO active_scrape_job (post_id) VALUES ($1)', [post_id]);
    console.log(`Active scrape job recorded for post ID: ${post_id}`);

    // Update the Google Sheet with the new job
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
    
    res.status(200).send({ message: `Job for post ${post_id} has been sent to the scraping queue.` });

  } catch (error) {
    console.error('Error in /api/scrape:', error);
    res.status(500).send({ error: 'Failed to queue scrape job.' });
  }
});


// WEBHOOK ENDPOINT to receive leads from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  
  let leads = [];
  let rawBody = req.body;

  // Step 1: Handle cases where the body is a buffer or plain text string
  if (Buffer.isBuffer(rawBody)) {
    rawBody = rawBody.toString('utf8');
  }
  if (typeof rawBody === 'string' && rawBody.length > 0) {
    try {
      rawBody = JSON.parse(rawBody);
    } catch (e) {
      console.error('Webhook body was a non-JSON string, cannot parse.');
      return res.status(400).send('Invalid data format.');
    }
  }

  // Step 2: Intelligently find the array of leads inside the parsed object
  if (Array.isArray(rawBody)) {
    leads = rawBody;
  } else if (rawBody && Array.isArray(rawBody.resultObject)) {
    leads = rawBody.resultObject;
  } else {
      console.log('Webhook payload did not contain a recognizable array of leads.');
  }
  
  if (leads.length === 0) {
    return res.status(200).send('Webhook received, no leads to process.');
  }
  
  try {
    // Step 3: Get the post ID for this job from our database
    const jobResult = await pool.query('SELECT post_id FROM active_scrape_job ORDER BY created_at DESC LIMIT 1');
    if (jobResult.rows.length === 0) {
      throw new Error("No active scrape job found to associate leads with.");
    }
    const postId = jobResult.rows[0].post_id;
    console.log(`Processing ${leads.length} leads for active post ID: ${postId}`);
    
    // Step 4: Loop through the leads and save them to the database
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl;
      if (username && profileUrl && postId) {
        const sql = 'INSERT INTO instagram_agent_leads (username, profile_url, post_id) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET last_updated = NOW(), post_id = $3';
        await pool.query(sql, [username, profileUrl, postId]);
      }
    }

    await pool.query('DELETE FROM active_scrape_job WHERE post_id = $1', [postId]);
    console.log('Successfully saved leads and cleaned up active job.');
    res.status(200).send('Webhook received and leads processed.');
  } catch (error) {
    console.error('Database error during webhook import:', error);
    res.status(500).send('Error processing webhook data.');
  }
});


// --- Start the Server ---
app.listen(port, () => console.log(`Server is listening on port ${port}`));

