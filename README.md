# Snip: URL Shortener with Analytics

Shorten long links and see who clicks them: referrers, devices, countries and clicks over time.

![Snip analytics dashboard](docs/analytics.png)

## Screenshots

| Sign in | Dashboard (light) | Dashboard (dark) |
|---|---|---|
| ![Login](docs/login.png) | ![Light mode](docs/dashboard-light.png) | ![Dark mode](docs/dashboard-dark.png) |

> The analytics screenshot uses generated sample click data. On localhost every visitor has a private IP, so real clicks show their country as "Unknown".

## Features

- **Authentication:** register and log in with email and password. Passwords are hashed with bcrypt and sessions use JWT. Every user only sees their own links.
- **Short links:** random 7-character codes or a custom alias, with URL validation. Snip refuses to shorten its own links.
- **Click tracking:** each redirect records the referrer, device type, browser, OS and country.
- **Analytics dashboard:** clicks over time (7, 14 or 30 days), top referrers, devices and countries, and an estimate of unique visitors.
- **Link management:** copy, pause, resume and delete links.
- **Dark mode:** follows the system theme and can be toggled manually.
- **Rate limiting:** separate limits for login, link creation and redirects.
- **Bot filtering:** crawlers, link previews and tools like curl are not counted as clicks.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Node.js, Express |
| Database | PostgreSQL (`pg`) |
| Auth and security | bcrypt, jsonwebtoken, express-rate-limit |
| Click parsing | ua-parser-js (device, browser, OS), geoip-lite (country) |
| Code generation | nanoid |
| Frontend | Vanilla JavaScript, CSS variables, SVG charts (no frameworks) |

## How it works

```
Browser ──GET /abc1234──▶ Express ──lookup (memory cache, then Postgres)──▶ 302 redirect
                             │
                             └── after responding: parse user agent + IP, insert a row into `clicks`

Dashboard ──GET /api/links (JWT)──▶ Express ──▶ links + last 30 days of clicks ──▶ charts
```

## Project structure

```
snip/
├── public/
│   └── index.html      # Dashboard UI (HTML, CSS and JS in one file)
├── docs/               # Screenshots used in this README
├── server.js           # Express app: auth, links API, redirect, click tracking
├── schema.sql          # PostgreSQL tables and indexes
├── package.json
└── .env.example        # Environment variable template
```

## Getting started

### Requirements

- [Node.js](https://nodejs.org) 18 or newer (LTS)
- [PostgreSQL](https://www.postgresql.org/download) 14 or newer

### 1. Install dependencies

```bash
npm install
```

### 2. Create the database

Open **SQL Shell (psql)** (or any terminal with `psql`), log in as `postgres`, and run:

```sql
CREATE DATABASE snip;
\c snip
\i 'C:/path/to/snip/schema.sql'
```

Use forward slashes in the path, even on Windows. Then run `\dt` to confirm that `users`, `links` and `clicks` exist.

On macOS or Linux you can run this instead:

```bash
createdb snip
psql -d snip -f schema.sql
```

### 3. Configure environment variables

```bash
cp .env.example .env        # on Windows: copy .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/snip
JWT_SECRET=a-long-random-string
PORT=3000
PGSSL=0
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If your database password contains special characters such as `@` or `#`, URL-encode them (`@` becomes `%40`).

### 4. Start the server

```bash
npm start
```

Open http://localhost:3000, create an account and shorten your first link.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign login tokens |
| `PORT` | Server port (default `3000`) |
| `PGSSL` | Set to `1` for hosts that require SSL for Postgres |

## API

All `/api/links` routes need an `Authorization: Bearer <token>` header.

| Method | Route | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` | Create an account, returns `{ token }` |
| POST | `/api/auth/login` | `{ email, password }` | Log in, returns `{ token }` |
| GET | `/api/links` | | Your links with their last 30 days of clicks |
| POST | `/api/links` | `{ url, alias? }` | Create a short link |
| PATCH | `/api/links/:id` | `{ active }` | Pause or resume a link |
| DELETE | `/api/links/:id` | | Delete a link and its clicks |
| GET | `/:code` | | 302 redirect to the original URL |

## Database schema

```
users   (id, email, password_hash, created_at)
links   (id, user_id → users, code UNIQUE, original_url, is_active, expires_at, created_at)
clicks  (id, link_id → links, clicked_at, referrer, country, device_type, browser, os, visitor_hash)
```

Indexes: `clicks(link_id, clicked_at)` for the analytics queries and `links(user_id)` for the dashboard list. Deleting a user or a link cascades to its clicks.

## Design decisions

- **302 instead of 301.** Browsers cache 301 redirects permanently, so repeat clicks would never reach the server and analytics would undercount.
- **Log after redirecting.** The redirect is sent first and the click is saved afterwards, so tracking never slows the visitor down.
- **No raw IPs stored.** Only a salted SHA-256 hash is kept, which is enough to estimate unique visitors.
- **In-memory redirect cache.** Hot links skip the database. The cache is cleared whenever a link is paused or deleted.
- **Collision-safe codes.** Random codes retry on a unique-constraint violation. Custom aliases return a clear "alias taken" error instead.
- **Input validation on the server.** URLs must be http or https with a real hostname, and aliases are limited to letters, numbers, dashes and underscores. Reserved names such as `api` are blocked.
- **Parameterized SQL everywhere**, and every link action checks that the link belongs to the logged-in user.

## Known limitations and next steps

- `GET /api/links` sends every click from the last 30 days. For links with many thousands of clicks, this should become `GROUP BY` queries that return only totals.
- The `expires_at` column and the redirect check exist, but there is no UI for setting an expiry yet.
- The redirect cache lives in process memory, so running several server instances would need Redis.
- Planned: QR code download, password-protected links, CSV export, automated tests and Docker support.

## What I learned

- Why a 301 redirect breaks analytics and how a 302 fixes it.
- How to store enough click data for useful reports without keeping personal information.
- Securing a small API with hashed passwords, JWT, rate limiting and ownership checks.
- Writing SQL aggregations and indexes for time-based analytics.
- Building a responsive dashboard with light and dark themes and no UI framework.

## Author

Built by [Sumit Singh](https://github.com/sumitxsingh).
