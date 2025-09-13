# Instagram Sales Agent

An Express.js service that helps you collect Instagram leads for sales outreach. It stores Instagram post URLs and scraped leads in PostgreSQL, integrates with Google Sheets to queue scrapes, and exposes a webhook endpoint to ingest results from PhantomBuster.

## Highlights

- REST API for managing Instagram posts and viewing scraped leads
- Webhook to ingest lead results from PhantomBuster (handles multiple payload shapes)
- Google Sheets integration to queue a scrape job by writing a post URL
- PostgreSQL persistence with simple schema and conflict handling
- CORS-enabled, JSON/text/urlencoded body parsing for flexible integrations

---

## Architecture at a glance

- Client/automation (Make/PhantomBuster/GitHub Actions/etc.) -> Express API (`index.js`)
- Database: PostgreSQL (tables: `instagram_posts`, `instagram_agent_leads`)
- Queue trigger: Google Sheets (first sheet cell A2 used to queue latest post URL)

```
+----------+       POST /api/scrape        +------------------+
|  Client  | ----------------------------> |  Google Sheets   |
+----------+                               +------------------+
      |                                            ^
      |                                            |
      |  POST /api/webhook/leads (PhantomBuster)  |
      v                                            |
+-----------------+     SELECT/INSERT     +------------------+
|  Express API    | --------------------> |  PostgreSQL      |
+-----------------+                       +------------------+
```

---

## Prerequisites

- Node.js 18+ (recommended)
- PostgreSQL 13+ (managed Postgres also works)
- A Google Cloud project with a Service Account that has access to Google Sheets API
- A Google Sheet shared with your Service Account email (editor)

---

## Setup

1. Install dependencies

```bash
npm install
```

2. Create a `.env` file in the project root:

```env
# Server
PORT=3000

# Database - full connection string, e.g. from Render/Railway/Neon/Cloud SQL
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME

# Google Sheets (Service Account)
# Use the service account email. Do NOT commit secrets to git.
GOOGLE_CLIENT_EMAIL=your-service-account@project-id.iam.gserviceaccount.com

# IMPORTANT: Encode newlines as \n if setting in an environment variable
# Example: "-----BEGIN PRIVATE KEY-----\nMIIEv...\n-----END PRIVATE KEY-----\n"
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
# The Spreadsheet ID (from the URL). The code writes to cell A2 on the first sheet.
GOOGLE_SHEET_ID=your_google_sheet_id
```

3. Create the database schema (run in psql or your favorite SQL tool)

```sql
-- Stores posts you want to scrape/leverage for lead discovery
CREATE TABLE IF NOT EXISTS instagram_posts (
  id SERIAL PRIMARY KEY,
  post_url TEXT UNIQUE NOT NULL,
  post_date TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Stores aggregated leads from PhantomBuster webhooks
CREATE TABLE IF NOT EXISTS instagram_agent_leads (
  username TEXT PRIMARY KEY,
  profile_url TEXT NOT NULL,
  last_updated TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Optional helpful indexes
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON instagram_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_last_updated ON instagram_agent_leads(last_updated DESC);
```

4. Run the server

```bash
node index.js
```

Optionally add a start script to `package.json` to run with `npm start`.

---

## Environment variables

- `PORT` – Port the Express server listens on (default: 3000)
- `DATABASE_URL` – Postgres connection string; SSL is enabled by default in the code with `rejectUnauthorized: false`
- `GOOGLE_CLIENT_EMAIL` – Service Account email for the Sheets API
- `GOOGLE_PRIVATE_KEY` – Service Account private key (newlines must be escaped as `\n` in env vars)
- `GOOGLE_SHEET_ID` – Spreadsheet ID to write the post URL into cell `A2`

Security tip: never commit your private key or `.env` to version control. If a key was pushed, rotate it immediately in Google Cloud IAM.

---

## API Reference

Base URL (local): `http://localhost:3000`

### Health check
- `GET /` → `"Server is running and accessible!"`

### Posts

- `GET /api/posts`
  - Returns an array of posts ordered by `created_at` (desc)
- `POST /api/posts`
  - Body: `{ "post_url": string, "post_date"?: ISO string }`
  - Inserts a post and returns it.

Example (HTTP file): see `test.http`

### Leads

- `GET /api/leads`
  - Returns an array of saved leads ordered by `last_updated` (desc)

### Queue a scrape (Google Sheets trigger)

- `POST /api/scrape`
  - Body: `{ "post_url": string }`
  - Clears range `A2:A` then writes the provided `post_url` to cell `A2` on the first sheet. Your automation can poll or schedule scrapes based on this value.

### Webhook (PhantomBuster results)

- `POST /api/webhook/leads`
  - Content-Type can be `application/json`, raw text, or payloads where leads are:
    - a JSON array in the body itself, or
    - present as a stringified JSON array in `resultObject`, or
    - present as an array in `resultObject`.
  - The service extracts `username` and `profile_url` (supports `profileUrl`, `profile_url`, or `profileLink`) and inserts new rows into `instagram_agent_leads` with `ON CONFLICT (username) DO NOTHING`.

Webhook success returns HTTP 200 and a summary in logs. If no recognizable leads are found, returns HTTP 200 with a note.

---

## Google Sheets Integration

This project writes the latest Instagram post URL to a Google Sheet as a lightweight queue trigger.

- Share the target spreadsheet with your Service Account email (editor access): `${GOOGLE_CLIENT_EMAIL}`
- Set `GOOGLE_SHEET_ID` in `.env`
- The code uses the first sheet and cell `A2`. If you need a named sheet (e.g., `Sheet1!A2`), adjust the range in `index.js` accordingly.

---

## PhantomBuster Integration

Configure your PhantomBuster to send webhook results to:

```
POST https://<your-domain>/api/webhook/leads
```

Payloads supported:
- Entire payload is an array of lead objects
- Payload object with `resultObject` as a stringified JSON array
- Payload object with `resultObject` as an array

Each lead object should contain:
- `username` (required)
- one of `profileUrl` | `profile_url` | `profileLink` (required)

---

## Try it locally

- Health: `GET http://localhost:3000/`
- Add a post: `POST http://localhost:3000/api/posts` with `{ "post_url": "https://www.instagram.com/p/.../", "post_date": "2025-01-01T12:00:00Z" }`
- Queue scrape: `POST http://localhost:3000/api/scrape` with `{ "post_url": "https://www.instagram.com/p/.../" }`
- Webhook: `POST http://localhost:3000/api/webhook/leads` with an array of `{ username, profileUrl }`

You can also use the provided `test.http` as a sample request file.

---

## Deployment notes

- Works well on Render/Railway/Fly/Heroku. Ensure you set the env vars listed above.
- PostgreSQL SSL: the code uses `ssl: { rejectUnauthorized: false }` which is typical for managed providers like Render. Adjust if your provider requires a different SSL mode.
- Configure your PhantomBuster webhook URL to the deployed `/api/webhook/leads` endpoint.

---

## Known gaps / Roadmap

- CSV upload endpoint (`/api/upload-leads`) is referenced by `upload.html` and packages (`multer`, `csv-parser`) are installed, but the route isn’t implemented yet.
  - Next step: implement multipart upload, parse CSV, and upsert into `instagram_agent_leads`.
- Add authentication (API key or OAuth) for write endpoints
- Add tests and CI
- Add pagination/filtering to `GET /api/posts` and `GET /api/leads`
- Improve Google Sheets range handling (use explicit sheet name)

---

## Troubleshooting

- Google auth errors: ensure the sheet is shared with your service account and `GOOGLE_PRIVATE_KEY` newlines are escaped (use `\\n` inside env values).
- 500 on DB calls: verify `DATABASE_URL` is correct and the tables exist.
- Webhook processed 0 leads: inspect the raw webhook payload; ensure it’s a JSON array or contains `resultObject` with a valid array/stringified array.

---

## License

ISC
