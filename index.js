// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const { google } = require('googleapis'); // <-- NEW
const cors = require('cors');
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json());
app.use(cors());
const port = process.env.PORT || 3000;

// Database connection pool (remains the same)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Main Routes ---
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
  // ... (this endpoint remains the same)
});


// --- UPDATED SCRAPE ENDPOINT ---
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required.' });
  }

  try {
    // 1. Authenticate with Google Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: 'credentials.json',
      scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 2. Define your Sheet ID and range
    const SPREADSHEET_ID = '1l8AVBYE88vGLZUDQ5S_COEkHhpdNe9t7N7_Ak8rOIdA';// <-- IMPORTANT: UPDATE THIS

    // 3. Clear the sheet first
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2:A', // Clears everything from the second row down
    });
    
    // 4. Add the new post URL to the sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'A2', // Puts the new URL in the second row
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[post_url]],
      },
    });
    // API endpoint to GET all scraped leads
  app.get('/api/leads', async (req, res) => {
    try {
      const sql = 'SELECT * FROM instagram_agent_leads ORDER BY last_updated DESC';
      const result = await pool.query(sql);
      res.json(result.rows); // Send the list of leads as JSON
    } catch (error) {
      console.error('Database error fetching leads:', error);
      res.status(500).send({ error: 'Failed to fetch leads.' });
    }
  });
    
    // We are no longer launching Phantom Buster directly from here.
    // Phantom Buster will be set up to launch automatically on a schedule.
    res.status(200).send({ message: `Post URL ${post_url} has been updated in the Google Sheet.` });

  } catch (error) {
    console.error('Error updating Google Sheet:', error);
    res.status(500).send({ error: 'Failed to update Google Sheet.' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});