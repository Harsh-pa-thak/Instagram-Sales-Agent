// Import necessary packages
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// --- App & Middleware Setup ---
const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing
// Add multiple body parsers to handle any data format Phantom Buster might send
app.use(express.raw({ type: '*/*', limit: '50mb' }));

const port = process.env.PORT || 3000;

// --- Database Connection ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Main Route ---
app.get('/', (req, res) => res.send('Server is running and accessible!'));

// --- API Endpoints for the Dashboard ---

// GET all posts to display
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM instagram_posts ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Database error fetching posts:', error);
    res.status(500).send({ error: 'Failed to fetch posts.' });
  }
});

// GET all scraped leads to display
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

// ADD a new post to the database (called by Make.com) - Requires a JSON parser
app.post('/api/posts', express.json(), async (req, res) => {
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

// TRIGGER a Phantom Buster scrape for a specific post - Requires a JSON parser
app.post('/api/scrape', express.json(), async (req, res) => {
  const { post_url } = req.body;
  if (!post_url) return res.status(400).send({ error: 'Post URL is required.' });

  try {
    const PHANTOM_ID = '2487161782151911'; // Your confirmed Phantom ID
    const PHANTOM_BUSTER_API_KEY = process.env.PHANTOM_BUSTER_API_KEY;

    if (!PHANTOM_BUSTER_API_KEY) throw new Error("Phantom Buster API key is not configured.");

    const endpoint = `https://api.phantombuster.com/api/v2/phantoms/${PHANTOM_ID}/launch`;
    
    // Corrected payload and headers for the API call
    const payload = { argument: { postUrls: [post_url] } };
    const headers = { 'X-Phantombuster-Key': PHANTOM_BUSTER_API_KEY };

    await axios.post(endpoint, payload, { headers: headers });
    res.status(200).send({ message: `Scraping job started for ${post_url}. The leads will appear automatically when finished.` });

  } catch (error) {
    console.error('Error launching Phantom Buster:', error.response ? error.response.data : error.message);
    res.status(500).send({ error: 'Failed to launch Phantom Buster job.' });
  }
});


// WEBHOOK ENDPOINT to automatically receive leads from Phantom Buster
app.post('/api/webhook/leads', async (req, res) => {
  console.log('--- PHANTOM BUSTER WEBHOOK RECEIVED ---');
  
  // Convert the raw buffer body to a string to handle any format
  const rawBodyAsString = req.body.toString('utf8');
  console.log('Raw Webhook Body:', rawBodyAsString);

  try {
    // First, parse the main JSON object from the string
    const webhookPayload = JSON.parse(rawBodyAsString);
    let leads = [];

    // The leads are in a stringified JSON array inside the 'resultObject' key.
    // We need to parse it a second time to get the actual array.
    if (webhookPayload && typeof webhookPayload.resultObject === 'string') {
      leads = JSON.parse(webhookPayload.resultObject);
    } else {
       console.log('Could not find a stringified resultObject. The data format may have changed.');
    }
    
    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(200).send('Webhook received, but contained no valid leads to process.');
    }
    
    console.log(`Successfully parsed ${leads.length} leads. Saving to database...`);
    
    let savedCount = 0;
    for (const lead of leads) {
      const username = lead.username;
      const profileUrl = lead.profileUrl || lead.profile_url || lead.profileLink;
      if (username && profileUrl) {
        const sql = 'INSERT INTO instagram_agent_leads (username, profile_url) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING';
        const result = await pool.query(sql, [username, profileUrl]);
        if (result.rowCount > 0) {
          savedCount++;
        }
      }
    }
    
    console.log(`Successfully saved ${savedCount} new leads to the database.`);
    res.status(200).send('Webhook received and leads processed.');

  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Error processing webhook data.');
  }
});

// Start the server
app.listen(port, () => console.log(`Server is listening on port ${port}`));

