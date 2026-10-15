'use strict';
/* Xmail: an anonymous inbox for the people who build X. Unofficial, not affiliated with X Corp.
 * Sign-in is one signed message (never a transaction). Wallet addresses are never shown; only codenames. */
const crypto = require('crypto');

const E = (k, d = '') => String(process.env[k] == null ? d : process.env[k]).trim();
const CA = E('XMAIL_CA'), XH = E('XMAIL_X');
const MIN_PCT = Number(E('XMAIL_MIN_PCT', '0')) || 0;   // % of $XMAIL supply needed to post, once the coin exists (0 = no gate)
const RPC_URL = E('RPC_URL');
const RPCS = [RPC_URL, 'https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'].filter(Boolean);
const DB_URL = E('XMAIL_DB_URL') || E('XMAIL_DB_DATABASE_URL') || E('XMAIL_DB_POSTGRES_URL') || E('DATABASE_URL') || E('POSTGRES_URL');
const SECRET = E('SESSION_SECRET') || crypto.createHash('sha256').update('xmail-session:' + DB_URL).digest('hex');
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FLOORS = ['eng', 'grok', 'ads', 'payments', 'product', 'design', 'trust-safety', 'sales', 'ex-x', 'other'];
const FLOOR_NAME = { eng: 'Eng', grok: 'Grok', ads: 'Ads', payments: 'Payments', product: 'Product', design: 'Design', 'trust-safety': 'T&S', sales: 'Sales', 'ex-x': 'Ex-X', other: 'Other' };
const NAME_RE = /^[a-z0-9_.]{3,16}$/;
const RESERVED = /^(admin|mod|mods|moderator|xmail|x|xcorp|elon|elonmusk|musk|support|official|team|staff|system|root|hr|legal|security)$/;
const HIDE_AT = 3;   // reports from 3 different people hide a message
const TAGS = ['comp', 'layoffs', 'culture', 'product', 'rumor', 'ama', 'vent', 'jobs'];
const PULSE = [
  { id: 'morale', q: 'Morale on your floor this week?', options: ['shipping', 'fine', 'meh', 'rough', 'burning'] },
  { id: 'hours', q: 'Hours you worked last week?', options: ['under 40', '40 to 60', '60 to 80', '80+'] },
  { id: 'stay', q: 'Still here in six months?', options: ['yes', 'probably', 'updating linkedin', 'already gone'] },
];
function isoWeek(d = new Date()) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = t.getUTCFullYear(); return y + '-W' + String(Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0'); }
const seenView = new Map();

/* ---------------- plumbing ---------------- */
function send(res, code, body) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); }
function http(code, msg, extra) { const e = new Error(msg); e.code = code; if (extra) e.extra = extra; return e; }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > 40000) break; }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (e) { return {}; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timedFetch = ms => (url, opt = {}) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
const clean = s => String(s == null ? '' : s).replace(/\u0000/g, '').replace(/[\u0001-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ');
const hits = new Map();
function limit(key, n, ms, msg) {
  const t = Date.now(), a = (hits.get(key) || []).filter(x => t - x < ms);
  if (a.length >= n) throw http(429, msg || 'Slow down a little.');
  a.push(t); hits.set(key, a); if (hits.size > 5000) hits.clear();
}

/* base58 + signatures */
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) { let n = 0n; for (const c of s) { const i = ALPH.indexOf(c); if (i < 0) throw new Error('bad'); n = n * 58n + BigInt(i); } let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex; const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex'); let z = 0; while (z < s.length && s[z] === '1') z++; return Buffer.concat([Buffer.alloc(z), body]); }
function b58enc(buf) { buf = Buffer.from(buf); let n = BigInt('0x' + (buf.toString('hex') || '0')); let s = ''; while (n > 0n) { s = ALPH[Number(n % 58n)] + s; n /= 58n; } for (const b of buf) { if (b === 0) s = '1' + s; else break; } return s; }
function verifySig(wallet, msg, sig) {
  try { const pub = b58dec(wallet); if (pub.length !== 32 || sig.length !== 64) return false; const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' }); return crypto.verify(null, msg, key, sig); } catch (e) { return false; }
}
const b64u = b => Buffer.from(b).toString('base64url');
function issue(wallet) { const p = b64u(JSON.stringify({ w: wallet, e: Date.now() + 14 * 864e5 })); return p + '.' + b64u(crypto.createHmac('sha256', SECRET).update(p).digest()); }
function who(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer ([\w-]+)\.([\w-]+)$/); if (!m) return null;
  const want = b64u(crypto.createHmac('sha256', SECRET).update(m[1]).digest());
  if (want.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]))) return null;
  try { const j = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return j.w && j.e > Date.now() ? j.w : null; } catch (e) { return null; }
}

/* ---------------- what gets posted: slurs scrubbed, contact details redacted, links left as text ---------------- */
const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g' };
const letters = w => String(w).toLowerCase().replace(/[01!|34@5$7+89]/g, c => LEET[c]).replace(/[^a-z]/g, '');
const squash = w => w.replace(/(.)\1+/g, '$1');
const LONG = /(niger|niga|nigr|nibba|fagot|fagit|trany|wetback|raghead|towelhead|junglebuny|porchmonkey|ziperhead|jigabo|retard)/;
const SHORT = /^(kikes?|chinks?|beaners?|gooks?|spics?|spick|coons?|dykes?|negro(es)?|cunts?|fags?|faggy|niggaz)$/;
const SAFE = /^(niger|nigeria|nigerian|nigerians|snigger|sniggers|sniggered|sniggering|retardant|spice|spicy|despicable|conspicuous|suspicious|auspicious|raccoon|cocoon|tycoon|scunthorpe|negroni)$/;
function slurry(w) { const a = letters(w); if (!a || SAFE.test(a)) return false; return SHORT.test(a) || LONG.test(squash(a)); }
function spacedSlur(text) { const runs = String(text).match(/(?:^|\s)((?:\S[\s._*-]+){3,}\S)(?=\s|$)/g) || []; return runs.some(r => { const a = letters(r); return !SAFE.test(a) && (SHORT.test(a) || LONG.test(squash(a))); }); }
function tidy(text, max) {
  let t = clean(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  if (spacedSlur(t)) throw http(400, 'That was blocked.');
  t = t.split(/(\s+)/).map(w => /^\s+$/.test(w) || !slurry(w) ? w : '*'.repeat(Math.min(8, Math.max(3, w.length)))).join('');
  // nobody gets doxxed here: emails and phone numbers are redacted before they are stored
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email redacted]').replace(/(?:\+?\d[\s().-]{0,2}){9,15}\d/g, m => /\d{4}-\d{2}-\d{2}/.test(m) ? m : '[number redacted]');
  return t;
}

/* ---------------- database ---------------- */
let sqlFn, ready;
function db() {
  if (!sqlFn) {
    if (E('XMAIL_LOCAL_PG')) { const { Pool } = require('pg'); const pool = new Pool({ connectionString: E('XMAIL_LOCAL_PG') }); sqlFn = async (strs, ...vals) => { let q = strs[0]; vals.forEach((v, i) => { q += '$' + (i + 1) + strs[i + 1]; }); return (await pool.query(q, vals)).rows; }; }
    else { if (!DB_URL) throw http(503, 'The database is not connected yet.'); const { neon } = require('@neondatabase/serverless'); sqlFn = neon(DB_URL); }
  }
  return sqlFn;
}
async function ensure() {
  if (ready) return ready;
  ready = (async () => {
    const s = db();
    await s`CREATE TABLE IF NOT EXISTS xm_nonces (nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, text TEXT NOT NULL, used BOOLEAN DEFAULT false, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE TABLE IF NOT EXISTS xm_users (wallet TEXT PRIMARY KEY, codename TEXT NOT NULL, floor TEXT DEFAULT 'other', at TIMESTAMPTZ DEFAULT now(), seen TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE UNIQUE INDEX IF NOT EXISTS xm_users_code ON xm_users (codename)`;
    await s`CREATE TABLE IF NOT EXISTS xm_threads (id BIGSERIAL PRIMARY KEY, author TEXT NOT NULL, codename TEXT, floor TEXT, to_name TEXT, subject TEXT, body TEXT, replies INT DEFAULT 0, votes INT DEFAULT 0, reports INT DEFAULT 0, hidden BOOLEAN DEFAULT false, at TIMESTAMPTZ DEFAULT now(), last_at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE INDEX IF NOT EXISTS xm_threads_last ON xm_threads (last_at DESC)`;
    await s`CREATE TABLE IF NOT EXISTS xm_msgs (id BIGSERIAL PRIMARY KEY, thread BIGINT NOT NULL, author TEXT NOT NULL, codename TEXT, floor TEXT, body TEXT, votes INT DEFAULT 0, reports INT DEFAULT 0, hidden BOOLEAN DEFAULT false, at TIMESTAMPTZ DEFAULT now())`;
    await s`CREATE INDEX IF NOT EXISTS xm_msgs_thread ON xm_msgs (thread, id)`;
    await s`CREATE TABLE IF NOT EXISTS xm_votes (kind TEXT, item BIGINT, wallet TEXT, PRIMARY KEY (kind, item, wallet))`;
    await s`CREATE TABLE IF NOT EXISTS xm_reports (kind TEXT, item BIGINT, wallet TEXT, PRIMARY KEY (kind, item, wallet))`;
    await s`CREATE TABLE IF NOT EXISTS xm_stars (wallet TEXT, thread BIGINT, PRIMARY KEY (wallet, thread))`;
    await s`ALTER TABLE xm_threads ADD COLUMN IF NOT EXISTS tag TEXT`;
    await s`ALTER TABLE xm_threads ADD COLUMN IF NOT EXISTS views INT DEFAULT 0`;
    await s`CREATE TABLE IF NOT EXISTS xm_pulse (q TEXT, wallet TEXT, week TEXT, floor TEXT, choice INT, at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (q, wallet, week))`;
  })();
  try { await ready; } catch (e) { ready = null; throw e; }
  return ready;
}
async function user(wallet) { return (await db()`SELECT codename, floor FROM xm_users WHERE wallet=${wallet}`)[0] || null; }
async function freshCodename() {
  const a = ['quiet', 'night', 'late', 'grey', 'blank', 'cold', 'lost', 'last', 'dark', 'still', 'odd', 'slow'], b = ['shift', 'desk', 'badge', 'floor', 'commit', 'build', 'ticket', 'deploy', 'standup', 'sprint', 'pager', 'cursor'];
  for (let i = 0; i < 12; i++) {
    const c = a[crypto.randomInt(a.length)] + '_' + b[crypto.randomInt(b.length)] + '_' + crypto.randomInt(10, 99);
    if (!(await db()`SELECT 1 FROM xm_users WHERE codename=${c}`).length) return c;
  }
  return 'anon_' + crypto.randomBytes(3).toString('hex');
}

/* ---------------- optional holder gate (only once the coin exists) ---------------- */
async function rpc(method, params) {
  let last;
  for (const u of RPCS) {
    try { const r = await timedFetch(9000)(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; }
    catch (e) { last = e; }
  }
  throw http(502, 'Solana RPC is busy, try again in a moment.');
}
const gateCache = new Map();
async function gate(wallet) {
  if (!CA || !MIN_PCT) return;
  const c = gateCache.get(wallet); if (c && Date.now() - c.t < 60e3 && c.ok) return;
  const [acc, mint] = await Promise.all([
    rpc('getTokenAccountsByOwner', [wallet, { mint: CA }, { encoding: 'jsonParsed' }]),
    rpc('getAccountInfo', [CA, { encoding: 'jsonParsed' }]),
  ]);
  const i = mint && mint.value && mint.value.data.parsed.info; const supply = i ? Number(i.supply) / 10 ** i.decimals : 0;
  const bal = (acc && acc.value || []).reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmountString || 0), 0);
  const ok = supply > 0 && bal / supply * 100 >= MIN_PCT;
  gateCache.set(wallet, { t: Date.now(), ok });
  if (!ok) throw http(403, `Posting needs ${MIN_PCT}% of $XMAIL in the connected wallet.`);
}

/* ---------------- shapes sent to the page (never a wallet) ---------------- */
const pubThread = (t, me) => ({ id: Number(t.id), codename: t.codename, floor: t.floor, to: t.to_name, subject: t.subject, preview: t.body ? t.body.slice(0, 140) : '', replies: t.replies, votes: t.votes, at: t.at, last: t.last_at, tag: t.tag || null, views: t.views || 0, mine: !!me && t.author === me, voted: !!t.voted, starred: !!t.starred });
const pubMsg = (m, me) => ({ id: Number(m.id), codename: m.codename, floor: m.floor, body: m.hidden ? null : m.body, hidden: m.hidden, votes: m.votes, at: m.at, mine: !!me && m.author === me, voted: !!m.voted });

/* ---------------- routes ---------------- */
const R = {};
R['GET config'] = async () => ({ ca: CA || null, x: XH || null, floors: FLOORS.map(f => ({ id: f, name: FLOOR_NAME[f] })), tags: TAGS, pulse: PULSE.map(p => p.id), gate: CA && MIN_PCT ? MIN_PCT : 0 });

R['GET nonce'] = async ({ q, req }) => {
  const wallet = String(q.wallet || ''); if (!B58.test(wallet)) throw http(400, 'Bad wallet.');
  limit('n:' + wallet, 8, 60e3);
  const nonce = b64u(crypto.randomBytes(12)), iso = new Date().toISOString();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'xmail').replace(/[^\w.:-]/g, '').slice(0, 80);
  const text = `${host} wants you to sign in with your Solana account:\n${wallet}\n\nSign in to Xmail. This is a free signature, not a transaction. It cannot move anything.\n\nNonce: ${nonce}\nIssued At: ${iso}`;
  await db()`INSERT INTO xm_nonces (nonce, wallet, text) VALUES (${nonce}, ${wallet}, ${text})`;
  db()`DELETE FROM xm_nonces WHERE at < now() - interval '1 day'`.catch(() => { });
  return { nonce, message: text };
};
R['POST login'] = async ({ b }) => {
  const wallet = String(b.wallet || ''); if (!B58.test(wallet)) throw http(400, 'Bad wallet.');
  const row = (await db()`SELECT * FROM xm_nonces WHERE nonce=${String(b.nonce || '')} AND wallet=${wallet} AND used=false AND at > now() - interval '10 minutes'`)[0];
  if (!row) throw http(401, 'That sign-in expired. Try again.');
  let sig; try { sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(b.sig || '') ? b58dec(b.sig) : Buffer.from(String(b.sig || ''), 'base64'); } catch (e) { throw http(400, 'Bad signature.'); }
  const msg = b.msg ? Buffer.from(String(b.msg), 'base64') : Buffer.from(row.text, 'utf8');
  if (!msg.toString('utf8').includes(row.text)) throw http(401, 'The signed message does not match.');
  if (!verifySig(wallet, msg, sig)) throw http(401, 'The signature does not match this wallet.');
  if (!(await db()`UPDATE xm_nonces SET used=true WHERE nonce=${row.nonce} AND used=false RETURNING nonce`).length) throw http(401, 'That sign-in was already used.');
  let u = await user(wallet), fresh = false;
  if (!u) { const c = await freshCodename(); await db()`INSERT INTO xm_users (wallet, codename) VALUES (${wallet}, ${c}) ON CONFLICT (wallet) DO NOTHING`; u = await user(wallet); fresh = true; }
  return { token: issue(wallet), codename: u.codename, floor: u.floor, fresh };
};
R['GET me'] = async ({ me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const u = await user(me); if (!u) throw http(401, 'Connect a wallet first.');
  await db()`UPDATE xm_users SET seen=now() WHERE wallet=${me}`;
  const t = (await db()`SELECT (SELECT count(*) FROM xm_threads WHERE author=${me})::int AS threads, (SELECT count(*) FROM xm_msgs WHERE author=${me})::int AS replies, (SELECT coalesce(sum(votes),0) FROM xm_threads WHERE author=${me})::int + (SELECT coalesce(sum(votes),0) FROM xm_msgs WHERE author=${me})::int AS votes`)[0];
  return { codename: u.codename, floor: u.floor, ...t };
};
R['POST profile'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  limit('p:' + me, 10, 3600e3);
  const code = String(b.codename || '').trim().toLowerCase(), floor = String(b.floor || '');
  if (!FLOORS.includes(floor)) throw http(400, 'Pick a floor.');
  if (!NAME_RE.test(code)) throw http(400, 'Codename: 3 to 16 lowercase letters, numbers, dots or underscores.');
  if (RESERVED.test(code) || slurry(code) || code.split(/[_.]+/).some(slurry)) throw http(400, 'Pick another codename.');
  try { await db()`UPDATE xm_users SET codename=${code}, floor=${floor} WHERE wallet=${me}`; }
  catch (e) { if (/duplicate|unique/i.test(e.message)) throw http(409, 'That codename is taken.'); throw e; }
  return { codename: code, floor };
};

R['GET threads'] = async ({ q, me }) => {
  const s = db(), folder = String(q.folder || 'inbox'), floor = FLOORS.includes(q.floor) ? q.floor : null;
  const term = clean(q.q || '').trim().slice(0, 60), like = '%' + term.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const meW = me || '', tag = TAGS.includes(q.tag) ? q.tag : null, top = q.sort === 'top';
  let rows;
  if (folder === 'following') {
    if (!me) return { threads: [], need: 'login' };
    rows = await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE NOT t.hidden AND (t.author=${me} OR EXISTS (SELECT 1 FROM xm_msgs m WHERE m.thread=t.id AND m.author=${me})) ORDER BY t.last_at DESC LIMIT 100`;
  } else if (folder === 'starred') {
    if (!me) return { threads: [], need: 'login' };
    rows = await s`SELECT t.*, true AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t JOIN xm_stars st ON st.thread=t.id AND st.wallet=${me} WHERE NOT t.hidden ORDER BY t.last_at DESC LIMIT 100`;
  } else if (folder === 'sent') {
    if (!me) return { threads: [], need: 'login' };
    rows = await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE t.author=${me} AND NOT t.hidden ORDER BY t.last_at DESC LIMIT 100`;
  } else if (folder === 'hot') {
    rows = await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE NOT t.hidden AND t.last_at > now() - interval '7 days' ORDER BY (t.votes * 2 + t.replies * 3) / power(extract(epoch FROM now() - t.at) / 3600 + 2, 1.3) DESC LIMIT 60`;
  } else if (folder === 'boss') {
    rows = await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE NOT t.hidden AND lower(t.to_name) IN ('elon', 'elonmusk', '@elonmusk', 'the boss', 'boss') ORDER BY t.last_at DESC LIMIT 100`;
  } else {
    rows = await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE NOT t.hidden AND (${floor}::text IS NULL OR t.floor=${floor}) AND (${tag}::text IS NULL OR t.tag=${tag}) AND (${term} = '' OR t.subject ILIKE ${like} OR t.body ILIKE ${like} OR t.to_name ILIKE ${like} OR t.codename ILIKE ${like}) ORDER BY CASE WHEN ${top}::boolean THEN t.votes * 2 + t.replies ELSE 0 END DESC, t.last_at DESC LIMIT 100`;
  }
  return { threads: rows.map(t => pubThread(t, me)) };
};
R['GET thread'] = async ({ q, me, req }) => {
  const id = parseInt(q.id, 10); if (!id) throw http(400, 'No such mail.');
  const s = db(), meW = me || '';
  const t = (await s`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE t.id=${id}`)[0];
  if (!t || t.hidden) throw http(404, 'That mail is gone.');
  const vk = (me || String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || 'x').split(',')[0].trim()) + ':' + id;
  if (!seenView.has(vk)) { seenView.set(vk, 1); if (seenView.size > 20000) seenView.clear(); await s`UPDATE xm_threads SET views=views+1 WHERE id=${id}`; t.views = (t.views || 0) + 1; }
  const msgs = await s`SELECT m.*, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='m' AND v.item=m.id AND v.wallet=${meW}) AS voted FROM xm_msgs m WHERE m.thread=${id} ORDER BY m.id ASC LIMIT 500`;
  return { thread: { ...pubThread(t, me), body: t.body, hidden: t.hidden }, msgs: msgs.map(m => pubMsg(m, me)) };
};
R['POST compose'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const u = await user(me); if (!u) throw http(401, 'Connect a wallet first.');
  limit('c:' + me, 3, 10 * 60e3, 'Three new mails per 10 minutes. Reply instead.');
  const tag = TAGS.includes(b.tag) ? b.tag : null, to = tidy(b.to || 'everyone', 40).replace(/\n/g, ' ') || 'everyone', subject = tidy(b.subject, 120).replace(/\n/g, ' '), body = tidy(b.body, 4000);
  if (subject.length < 2) throw http(400, 'Add a subject.');
  if (body.length < 2) throw http(400, 'Write something.');
  await gate(me);
  const r = await db()`INSERT INTO xm_threads (author, codename, floor, to_name, subject, body, tag) VALUES (${me}, ${u.codename}, ${u.floor}, ${to}, ${subject}, ${body}, ${tag}) RETURNING id`;
  return { ok: true, id: Number(r[0].id) };
};
R['POST reply'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const u = await user(me); if (!u) throw http(401, 'Connect a wallet first.');
  const id = parseInt(b.thread, 10); const body = tidy(b.body, 3000);
  if (body.length < 1) throw http(400, 'Write something.');
  limit('r:' + me, 10, 60e3);
  await gate(me);
  const t = (await db()`SELECT id, hidden FROM xm_threads WHERE id=${id}`)[0]; if (!t || t.hidden) throw http(404, 'That mail is gone.');
  const r = await db()`INSERT INTO xm_msgs (thread, author, codename, floor, body) VALUES (${id}, ${me}, ${u.codename}, ${u.floor}, ${body}) RETURNING id`;
  await db()`UPDATE xm_threads SET replies=replies+1, last_at=now() WHERE id=${id}`;
  return { ok: true, id: Number(r[0].id) };
};
R['POST vote'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const kind = b.kind === 'm' ? 'm' : 't', id = parseInt(b.id, 10); limit('v:' + me, 60, 60e3);
  const ins = await db()`INSERT INTO xm_votes (kind, item, wallet) VALUES (${kind}, ${id}, ${me}) ON CONFLICT DO NOTHING RETURNING item`;
  if (ins.length) { if (kind === 't') await db()`UPDATE xm_threads SET votes=votes+1 WHERE id=${id}`; else await db()`UPDATE xm_msgs SET votes=votes+1 WHERE id=${id}`; return { ok: true, voted: true }; }
  await db()`DELETE FROM xm_votes WHERE kind=${kind} AND item=${id} AND wallet=${me}`;
  if (kind === 't') await db()`UPDATE xm_threads SET votes=greatest(votes-1,0) WHERE id=${id}`; else await db()`UPDATE xm_msgs SET votes=greatest(votes-1,0) WHERE id=${id}`;
  return { ok: true, voted: false };
};
R['POST star'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const id = parseInt(b.thread, 10);
  const ins = await db()`INSERT INTO xm_stars (wallet, thread) VALUES (${me}, ${id}) ON CONFLICT DO NOTHING RETURNING thread`;
  if (!ins.length) await db()`DELETE FROM xm_stars WHERE wallet=${me} AND thread=${id}`;
  return { ok: true, starred: !!ins.length };
};
R['POST report'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const kind = b.kind === 'm' ? 'm' : 't', id = parseInt(b.id, 10); limit('rp:' + me, 20, 3600e3);
  const ins = await db()`INSERT INTO xm_reports (kind, item, wallet) VALUES (${kind}, ${id}, ${me}) ON CONFLICT DO NOTHING RETURNING item`;
  if (ins.length) {
    if (kind === 't') await db()`UPDATE xm_threads SET reports=reports+1, hidden=(reports+1 >= ${HIDE_AT}) WHERE id=${id}`;
    else await db()`UPDATE xm_msgs SET reports=reports+1, hidden=(reports+1 >= ${HIDE_AT}) WHERE id=${id}`;
  }
  return { ok: true };
};
R['POST delete'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const kind = b.kind === 'm' ? 'm' : 't', id = parseInt(b.id, 10);
  const r = kind === 't'
    ? await db()`UPDATE xm_threads SET hidden=true, body='', subject='[deleted]' WHERE id=${id} AND author=${me} RETURNING id`
    : await db()`UPDATE xm_msgs SET hidden=true, body='' WHERE id=${id} AND author=${me} RETURNING id`;
  if (!r.length) throw http(403, 'You can only delete your own mail.');
  return { ok: true };
};
R['GET floors'] = async () => {
  const rows = await db()`SELECT floor, count(*)::int AS threads, count(*) FILTER (WHERE at > now() - interval '24 hours')::int AS today, max(last_at) AS last FROM xm_threads WHERE NOT hidden GROUP BY floor`;
  const people = await db()`SELECT floor, count(*)::int AS n FROM xm_users GROUP BY floor`;
  const t = (await db()`SELECT (SELECT count(*) FROM xm_threads WHERE NOT hidden)::int AS threads, (SELECT count(*) FROM xm_msgs WHERE NOT hidden)::int AS replies, (SELECT count(*) FROM xm_users)::int AS people, (SELECT count(*) FROM xm_users WHERE seen > now() - interval '10 minutes')::int AS online`)[0];
  const by = Object.fromEntries(rows.map(r => [r.floor, r])), pp = Object.fromEntries(people.map(r => [r.floor, r.n]));
  return { floors: FLOORS.map(f => ({ id: f, name: FLOOR_NAME[f], threads: by[f] ? by[f].threads : 0, today: by[f] ? by[f].today : 0, last: by[f] ? by[f].last : null, people: pp[f] || 0 })), totals: t };
};

/* live wire: the latest mail and replies across every floor */
R['GET activity'] = async () => {
  const s = db();
  const a = await s`SELECT 'mail' AS kind, t.id AS thread, t.subject, t.to_name, t.codename, t.floor, t.tag, left(t.body, 140) AS body, t.at FROM xm_threads t WHERE NOT t.hidden ORDER BY t.at DESC LIMIT 30`;
  const b = await s`SELECT 'reply' AS kind, m.thread, t.subject, t.to_name, m.codename, m.floor, t.tag, left(m.body, 140) AS body, m.at FROM xm_msgs m JOIN xm_threads t ON t.id=m.thread WHERE NOT m.hidden AND NOT t.hidden ORDER BY m.at DESC LIMIT 30`;
  const all = a.concat(b).sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 40);
  return { items: all.map(x => ({ kind: x.kind, thread: Number(x.thread), subject: x.subject, to: x.to_name, codename: x.codename, floor: x.floor, tag: x.tag, body: x.body, at: x.at })) };
};
/* office hours: when people post, last 30 days (minutes since epoch; the page buckets them in the viewer's time zone) */
R['GET heat'] = async () => {
  const r = await db()`SELECT (extract(epoch FROM x.at) / 60)::bigint AS m FROM (SELECT at FROM xm_threads WHERE NOT hidden AND at > now() - interval '30 days' UNION ALL SELECT at FROM xm_msgs WHERE NOT hidden AND at > now() - interval '30 days') x ORDER BY x.at DESC LIMIT 5000`;
  return { mins: r.map(x => Number(x.m)) };
};
R['GET top'] = async ({ q, me }) => {
  const range = ['week', 'month', 'all'].includes(q.range) ? q.range : 'week', days = range === 'week' ? 7 : range === 'month' ? 30 : 36500, meW = me || '';
  const rows = await db()`SELECT t.*, EXISTS (SELECT 1 FROM xm_stars st WHERE st.thread=t.id AND st.wallet=${meW}) AS starred, EXISTS (SELECT 1 FROM xm_votes v WHERE v.kind='t' AND v.item=t.id AND v.wallet=${meW}) AS voted FROM xm_threads t WHERE NOT t.hidden AND t.at > now() - make_interval(days => ${days}::int) AND (t.votes > 0 OR t.replies > 0) ORDER BY t.votes DESC, t.replies DESC, t.at DESC LIMIT 25`;
  return { range, threads: rows.map(t => pubThread(t, me)) };
};
/* pulse: three anonymous questions, one answer per wallet per week */
R['GET pulse'] = async ({ me }) => {
  const week = isoWeek(), s = db();
  const rows = await s`SELECT q, floor, choice, count(*)::int AS n FROM xm_pulse WHERE week=${week} GROUP BY q, floor, choice`;
  const mine = me ? await s`SELECT q, choice FROM xm_pulse WHERE week=${week} AND wallet=${me}` : [];
  return {
    week, questions: PULSE.map(p => {
      const counts = p.options.map(() => 0), byFloor = {};
      rows.filter(r => r.q === p.id && r.choice >= 0 && r.choice < p.options.length).forEach(r => { counts[r.choice] += r.n; const f = r.floor || 'other'; (byFloor[f] = byFloor[f] || p.options.map(() => 0))[r.choice] += r.n; });
      const m = mine.find(x => x.q === p.id);
      return { id: p.id, q: p.q, options: p.options, counts, byFloor, total: counts.reduce((a, b) => a + b, 0), mine: m ? m.choice : null };
    }),
  };
};
R['POST pulse'] = async ({ b, me }) => {
  if (!me) throw http(401, 'Connect a wallet first.');
  const p = PULSE.find(x => x.id === b.q), c = parseInt(b.choice, 10);
  if (!p || !(c >= 0 && c < p.options.length)) throw http(400, 'Pick an answer.');
  limit('pl:' + me, 30, 3600e3);
  const u = await user(me); if (!u) throw http(401, 'Connect a wallet first.');
  await db()`INSERT INTO xm_pulse (q, wallet, week, floor, choice) VALUES (${p.id}, ${me}, ${isoWeek()}, ${u.floor}, ${c}) ON CONFLICT (q, wallet, week) DO UPDATE SET choice=EXCLUDED.choice, floor=EXCLUDED.floor, at=now()`;
  return { ok: true };
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = String((req.query && req.query.__p) || url.searchParams.get('__p') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
  const q = Object.fromEntries(url.searchParams), key = `${req.method} ${path}`, fn = R[key];
  if (!fn) return send(res, 404, { ok: false, error: 'No such endpoint.' });
  try {
    if (key !== 'GET config') await ensure();
    const b = req.method === 'POST' ? await readBody(req) : {};
    send(res, 200, await fn({ q, b, req, me: who(req) }));
  } catch (e) {
    const code = e.code && e.code >= 400 && e.code < 600 ? e.code : 500;
    if (code === 500) console.error(key, e);
    send(res, code, Object.assign({ ok: false, error: code === 500 ? 'Something broke on our side. Try again.' : e.message }, e.extra || {}));
  }
};
module.exports._t = { b58enc, tidy };
