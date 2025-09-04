// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis'); // For connecting to Google Sheets
const cors = require('cors');
require('dotenv').config(); // To read secret keys from the environment

// --- App & Middleware Setup ---
const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing for your frontend
app.use(express.json({ limit: '50mb' })); // Enable the app to parse large JSON bodies
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // For other data formats

const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev

// --- Database Connection ---
// Create a connection pool to your Neon PostgreSQL database
// It securely uses the connection string from your Render environment variables
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for connecting to Neon
  }
});

// --- Main Route ---
// A simple root route to confirm that the server is running
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// --- API Endpoints for the Dashboard ---

// GET all posts to display on the frontend dashboard
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

// GET all scraped leads to display on the frontend dashboard
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

// ADD a new post to the database (called by Make.com)
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

// TRIGGER: Adds a post URL and ID to the Google Sheet to queue a scrape job
app.post('/api/scrape', async (req, res) => {
  const { post_url, post_id } = req.body; // Receive both the URL and the post's unique ID
  if (!post_url || !post_id) {
    return res.status(400).send({ error: 'Post URL and Post ID are required.' });
  }

  try {
    // 1. Authenticate with Google Sheets using the keys stored securely on Render
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        // The private key from Render's environment needs its newline characters restored
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

    // 2. Clear the old job from the sheet to make space for the new one
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:B', // Clear both columns to ensure only one job runs
    });
    
    // 3. Add the new post URL and post ID to the sheet, where Phantom Buster will find them
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[post_url, post_id]], // Write both the URL and the ID
      },
    });
    
    res.status(200).send({ message: `Job for post ${post_id} has been sent to the scraping queue.` });

  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    res.status(500).send({ error: 'Failed to update Google Sheet.' });
  }
});


// WEBHOOK ENDPOINT to automatically receive leads from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  
  let leads = [];
  const rawBody = req.body;

  // Intelligently find the array of leads, as Phantom Buster's format can vary
  if (rawBody && Array.isArray(rawBody.resultObject)) {
    leads = rawBody.resultObject;
  } else if (Array.isArray(rawBody)) {
    leads = rawBody;
  }
  
  if (leads.length === 0) {
    return res.status(200).send('Webhook received, no leads to process.');
  }
  
  // The post_id will be the same for all leads in this batch.
  // We get it from the metadata Phantom Buster passes through from the Google Sheet.
  const postId = leads[0].postId; 
  console.log(`Processing ${leads.length} leads for post ID: ${postId}`);
  
  try {
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl;
      // We must have a postId to link the lead to a post
      if (username && profileUrl && postId) {
        // Updated query to also insert the post_id
        const sql = 'INSERT INTO instagram_agent_leads (username, profile_url, post_id) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET last_updated = NOW(), post_id = $3';
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


// --- Start the Server ---
app.listen(port, () => console.log(`Server is listening on port ${port}`));

