# Snip: URL shortener with analytics

Node + Express + PostgreSQL backend with a vanilla JS dashboard (`public/index.html`).

## Run locally
1. `npm install`
2. Create a database: `createdb snip`
3. `cp .env.example .env`, then set `DATABASE_URL` and a long random `JWT_SECRET`
4. `npm run db` (creates the tables from `schema.sql`)
5. `npm start`, then open http://localhost:3000 and create an account

## API
| Method | Route | Notes |
|---|---|---|
| POST | /api/auth/register, /api/auth/login | `{email, password}` returns `{token}` |
| GET | /api/links | Your links with the last 30 days of clicks |
| POST | /api/links | `{url, alias?}` |
| PATCH | /api/links/:id | `{active: boolean}` |
| DELETE | /api/links/:id | Also deletes its clicks |
| GET | /:code | 302 redirect, click logged asynchronously |

## Deploy (Render or Railway)
Create a Postgres database, run `schema.sql` on it, set `DATABASE_URL`, `JWT_SECRET` and `PGSSL=1`, build with `npm install`, start with `npm start`.

## Design notes
- 302 (not 301) so browsers never cache the redirect and hide clicks from analytics.
- Visitor IPs are never stored, only a salted hash used for unique-visitor estimates.
- Bots are skipped when counting clicks. Redirects are cached in memory.
- Scaling idea: replace "send all clicks" in `GET /api/links` with `GROUP BY` queries once a link has many thousands of clicks.
