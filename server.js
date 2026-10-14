require('dotenv').config();
const express = require('express'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg'), bcrypt = require('bcrypt'), jwt = require('jsonwebtoken'), { nanoid } = require('nanoid');
const rateLimit = require('express-rate-limit'), UAParser = require('ua-parser-js'), geoip = require('geoip-lite');

const { DATABASE_URL, JWT_SECRET, PORT = 3000 } = process.env;
if (!DATABASE_URL || !JWT_SECRET) throw new Error('Set DATABASE_URL and JWT_SECRET in .env');

const db = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined });
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const cache = new Map(); // code -> { id, url, exp }
const RESERVED = new Set(['api', 'assets', 'favicon.ico', 'index.html']);
const lim = (n, ms) => rateLimit({ windowMs: ms, limit: n, standardHeaders: true, legacyHeaders: false });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Something went wrong.' }); });
const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  try { req.uid = jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Please sign in again.' }); }
};

function cleanUrl(u, host) {
  try {
    let s = String(u).trim();
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    const p = new URL(s);
    if (!/^https?:$/.test(p.protocol) || !p.hostname.includes('.') || p.host === host) return null;
    return p.href;
  } catch { return null; }
}

app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth
app.post('/api/auth/register', lim(20, 15 * 60e3), wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 8) return res.status(400).json({ error: 'Use a valid email and a password of 8+ characters.' });
  try {
    const { rows: [u] } = await db.query('insert into users(email,password_hash) values($1,$2) returning id', [email, await bcrypt.hash(pw, 10)]);
    res.json({ token: sign(u) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    throw e;
  }
}));

app.post('/api/auth/login', lim(20, 15 * 60e3), wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), pw = String(req.body.password || '');
  const { rows: [u] } = await db.query('select id,password_hash from users where email=$1', [email]);
  if (!u || !(await bcrypt.compare(pw, u.password_hash))) return res.status(401).json({ error: 'Wrong email or password.' });
  res.json({ token: sign(u) });
}));

// ---- Links (each link includes its last 30 days of clicks for the dashboard)
app.get('/api/links', auth, wrap(async (req, res) => {
  const { rows } = await db.query(`
    select l.id, l.code, l.original_url as url, l.is_active as active, l.created_at,
      coalesce(json_agg(json_build_object('t', extract(epoch from c.clicked_at)::float8 * 1000,
        'ref', c.referrer, 'dev', c.device_type, 'ct', c.country, 'v', c.visitor_hash))
        filter (where c.id is not null), '[]') as clicks
    from links l left join clicks c on c.link_id = l.id and c.clicked_at > now() - interval '30 days'
    where l.user_id = $1 group by l.id order by l.created_at desc`, [req.uid]);
  res.json(rows);
}));

app.post('/api/links', auth, lim(60, 15 * 60e3), wrap(async (req, res) => {
  const url = cleanUrl(req.body.url, req.headers.host);
  if (!url) return res.status(400).json({ error: "That doesn't look like a valid URL." });
  const alias = String(req.body.alias || '').trim();
  if (alias && (!/^[\w-]{3,30}$/.test(alias) || RESERVED.has(alias))) return res.status(400).json({ error: 'Alias: 3-30 letters, numbers, dashes or underscores.' });
  for (let i = 0; i < 5; i++) {
    try {
      const { rows: [l] } = await db.query('insert into links(user_id,code,original_url) values($1,$2,$3) returning id,code', [req.uid, alias || nanoid(7), url]);
      return res.json(l);
    } catch (e) {
      if (e.code !== '23505') throw e;
      if (alias) return res.status(409).json({ error: 'That alias is taken. Try another.' });
    }
  }
  res.status(500).json({ error: 'Could not generate a code. Try again.' });
}));

app.patch('/api/links/:id', auth, wrap(async (req, res) => {
  const { rowCount } = await db.query('update links set is_active=$1 where id=$2 and user_id=$3', [!!req.body.active, req.params.id, req.uid]);
  cache.clear();
  rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Link not found.' });
}));

app.delete('/api/links/:id', auth, wrap(async (req, res) => {
  const { rowCount } = await db.query('delete from links where id=$1 and user_id=$2', [req.params.id, req.uid]);
  cache.clear();
  rowCount ? res.json({ ok: true }) : res.status(404).json({ error: 'Link not found.' });
}));

// ---- Redirect + click tracking
async function track(id, req) {
  const ua = req.headers['user-agent'] || '';
  if (/bot|crawl|spider|preview|curl|wget/i.test(ua)) return;
  const ip = req.ip, r = new UAParser(ua).getResult();
  let ref = 'Direct';
  try { if (req.headers.referer) ref = new URL(req.headers.referer).hostname.replace(/^www\./, ''); } catch {}
  const cc = geoip.lookup(ip)?.country;
  const dev = r.device.type === 'mobile' ? 'Mobile' : r.device.type === 'tablet' ? 'Tablet' : 'Desktop';
  const visitor = crypto.createHash('sha256').update(ip + ua + JWT_SECRET).digest('hex').slice(0, 16);
  await db.query('insert into clicks(link_id,referrer,country,device_type,browser,os,visitor_hash) values($1,$2,$3,$4,$5,$6,$7)',
    [id, ref, cc ? regions.of(cc) : 'Unknown', dev, r.browser.name || 'Other', r.os.name || 'Other', visitor]);
}

app.get('/:code([\\w-]{3,30})', lim(300, 60e3), wrap(async (req, res) => {
  const code = req.params.code;
  let l = cache.get(code);
  if (!l) {
    const { rows: [r] } = await db.query('select id, original_url as url, expires_at as exp from links where code=$1 and is_active', [code]);
    if (r) { l = r; cache.set(code, l); }
  }
  if (!l || (l.exp && new Date(l.exp) < new Date())) return res.status(404).send('Link not found');
  res.redirect(302, l.url); // 302, not 301, so every click reaches the server
  track(l.id, req).catch(console.error);
}));

app.listen(PORT, () => console.log(`Snip running on http://localhost:${PORT}`));
