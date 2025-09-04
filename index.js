// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis');
const cors = require('cors');
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

// TRIGGER: Adds a post URL and ID to the Google Sheet queue
app.post('/api/scrape', async (req, res) => {
  const { post_url, post_id } = req.body; // Now we get post_id as well
  if (!post_url || !post_id) {
    return res.status(400).send({ error: 'Post URL and Post ID are required.' });
  }

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

    // Clear the old job
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:B', // Clear both columns
    });
    
    // Add the new job with URL and ID
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[post_url, post_id]], // Write both URL and ID
      },
    });
    
    res.status(200).send({ message: `Job for post ${post_id} has been sent to the scraping queue.` });

  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    res.status(500).send({ error: 'Failed to update Google Sheet.' });
  }
});


// WEBHOOK ENDPOINT to receive leads from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  
  let leads = [];
  const rawBody = req.body;

  if (rawBody && Array.isArray(rawBody.resultObject)) {
    leads = rawBody.resultObject;
  } else if (Array.isArray(rawBody)) {
    leads = rawBody;
  }
  
  if (leads.length === 0) {
    return res.status(200).send('Webhook received, no leads to process.');
  }
  
  // The post_id will be the same for all leads in this batch
  const postId = leads[0].postId; // Get the post_id from the first lead
  console.log(`Processing ${leads.length} leads for post ID: ${postId}`);
  
  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl;
      // We must have a postId to link the lead to a post
      if (username && profileUrl && postId) {
        const sql = 'INSERT INTO instagram_agent_leads (username, profile_url, post_id) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET last_updated = NOW()';
        await pool.query(sql, [username, profileUrl, postId]);
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

