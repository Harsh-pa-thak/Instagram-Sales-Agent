// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config();

// Create the Express app
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
const port = 3000;
const upload = multer({ dest: 'uploads/' }); // Configure multer

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Main Routes ---

// Test route
app.get('/', (req, res) => {
  res.send('Server is running and accessible!');
});

// Route to serve the upload page
app.get('/upload', (req, res) => {
  res.sendFile(__dirname + '/upload.html');
});

// --- API Endpoints ---

// API endpoint to add a new post from Make.com
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

// API endpoint to upload a CSV of leads
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
        fs.unlinkSync(filePath); // Clean up the uploaded file
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