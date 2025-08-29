// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const cors = require('cors');
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
app.use(cors()); // Middleware to enable Cross-Origin Resource Sharing
const port = 3000;
const upload = multer({ dest: 'uploads/' }); // Configure multer for file uploads

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

// NEW: API endpoint to GET all posts for the dashboard
app.get('/api/posts', async (req, res) => {
  try {
    const sql = 'SELECT * FROM instagram_posts ORDER BY created_at DESC';
    const result = await pool.query(sql);
    res.json(result.rows); // Send the list of posts as JSON
  } catch (error) {
    console.error('Database error fetching posts:', error);
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// API endpoint to ADD a new post (from Make.com or n8n)
app.post('/api/posts', async (req, res) => {
  const { post_url, post_date } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required.' });
  }
  console.log('Received request to add post:', post_url);
  try {
    const sql = 'INSERT INTO instagram_posts (post_url, post_date) VALUES ($1, $2) RETURNING *';
    const result = await pool.query(sql, [post_url, post_date]);
    res.status(201).send({ message: 'Post added successfully!', post: result.rows[0] });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).send({ error: 'Failed to add post.' });
  }
});
// API endpoint to trigger a Phantom Buster scrape for a specific post
app.post('/api/scrape', async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) {
    return res.status(400).send({ error: 'Post URL is required to start scrape.' });
  }

  console.log('Received request to scrape post:', post_url);
  
  try {
    // IMPORTANT: Replace this with the ID of your "Post Likers Export" Phantom
    const PHANTOM_ID = 'https://phantombuster.com/6340322393587235/phantoms/2487161782151911'; 
    const PHANTOM_BUSTER_API_KEY = process.env.PHANTOM_BUSTER_API_KEY;

    if (!PHANTOM_BUSTER_API_KEY) {
      throw new Error("Phantom Buster API key is not configured.");
    }

    const axios = require('axios');
    const endpoint = `https://api.phantombuster.com/api/v2/phantoms/${PHANTOM_ID}/launch`;

    await axios.post(endpoint, {}, {
      headers: {
        'Content-Type': 'application/json',
        'X-Phantombuster-Key': PHANTOM_BUSTER_API_KEY
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


// API endpoint to upload a CSV of leads from the HTML form
app.post('/api/upload-leads', upload.single('leadsFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  const results = [];
  const filePath = req.file.path;
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        for (const lead of results) {
          const username = lead.username;
          const profileUrl = lead.profileUrl;
          if (username && profileUrl) {
            const sql = 'INSERT INTO instagram_agent_leads (username, profile_url) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING';
            await pool.query(sql, [username, profileUrl]);
          }
        }
        fs.unlinkSync(filePath);
        res.status(200).send({ message: `${results.length} leads processed and saved successfully!` });
      } catch (error) {
        console.error('Database error during CSV import:', error);
        res.status(500).send({ error: 'Failed to save leads to database.' });
      }
    });
});

// Start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});