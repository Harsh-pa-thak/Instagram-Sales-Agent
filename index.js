// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const cors = require('cors');
const axios = require('axios'); // <-- ADD THIS FOR PHANTOM BUSTER
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json());
app.use(cors());
const port = 3000;
const upload = multer({ dest: 'uploads/' });

// Database connection pool
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

app.get('/upload', (req, res) => {
  res.sendFile(__dirname + '/upload.html');
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
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required.' });
  }
  try {
    const sql = 'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(sql, [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});

// UPLOAD a CSV of leads
app.post('/api/upload-leads', upload.single('leadsFile'), (req, res) => {
  // ... (your existing upload code)
});

// --- NEW: API endpoint to trigger a Phantom Buster scrape ---
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required to start scrape.' });
  }

  try {
    // IMPORTANT: Replace this with the ID of your "Post Likers Export" Phantom
    const PHANTOM_ID = '6340322393587235';
    const PHANTOM_BUSTER_API_KEY = process.env.PHANTOM_BUSTER_API_KEY;

    if (!PHANTOM_BUSTER_API_KEY) {
      throw new Error("Phantom Buster API key is not configured.");
    }

    const endpoint = `https://api.phantombuster.com/api/v2/phantoms/${PHANTOM_ID}/launch`;

    // Make the API call to Phantom Buster
    await axios.post(endpoint, null, {
        headers: {
            'X-Phantombuster-Key': PHANTOM_BUSTER_API_KEY,
            'Content-Type': 'application/json'
        },
        data: {
            argument: JSON.stringify({
                postUrls: [post_url]
            })
        }
    });

    res.status(200).send({ message: `Scraping job started for ${post_url}` });

  } catch (error) {
    console.error('Error launching Phantom Buster:', error.response ? error.response.data : error.message);
    res.status(500).send({ error: 'Failed to launch Phantom Buster job.' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});