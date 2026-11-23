// Anonyme Umfrage Dirigententagung – kein Framework, keine Abhängigkeiten.
// Speichert NUR die Antworten: keine IP, keine Uhrzeit, keine Cookies, keine Reihenfolge.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'antworten.json');
const PASSWORD = process.env.RESULTS_PASSWORD || 'Tagung2026!';
const PUBLIC = path.join(__dirname, 'public');

// ---- Fragebogen-Definition (muss zu public/index.html passen) ----
const OPTIONS = {
  zeit: ['u30', '30-60', '1-2', '2-4', 'ue4'],
  auswahl: ['tag', '1-3t', '3-5t', '1w', 'ue1w'],
  relevanz: ['1', '2', '3', '4'],
  ensemble: ['chor', 'orchester', 'beides', ''],
};

function validate(b) {
  if (!b || typeof b !== 'object') return null;
  const out = {};
  for (const k of ['zeit', 'auswahl', 'relevanz']) {
    if (!OPTIONS[k].includes(String(b[k]))) return null;
    out[k] = String(b[k]);
  }
  const dirigat = Number(b.dirigat), botschaft = Number(b.botschaft), vorb = Number(b.vorbereitet);
  for (const v of [dirigat, botschaft]) if (!Number.isInteger(v) || v < 0 || v > 100 || v % 5) return null;
  if (dirigat + botschaft > 100) return null;
  if (!Number.isInteger(vorb) || vorb < 1 || vorb > 10) return null;
  out.dirigat = dirigat;
  out.botschaft = botschaft;
  out.vorbereitet = vorb;
  const ens = b.ensemble == null ? '' : String(b.ensemble);
  if (!OPTIONS.ensemble.includes(ens)) return null;
  out.ensemble = ens;
  const kommentar = typeof b.kommentar === 'string' ? b.kommentar.trim().slice(0, 1000) : '';
  out.kommentar = kommentar;
  return out;
}

// ---- Speicher ----
fs.mkdirSync(DATA_DIR, { recursive: true });
let antworten = [];
try { antworten = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { antworten = []; }

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(antworten));
  fs.renameSync(tmp, DATA_FILE);
}

function addAntwort(a) {
  // An zufälliger Stelle einfügen: Die Reihenfolge verrät nicht, wer wann abgegeben hat.
  antworten.splice(crypto.randomInt(antworten.length + 1), 0, a);
  save();
}

// ---- Missbrauchsschutz (nur im Arbeitsspeicher, nichts wird gespeichert) ----
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || now - e.t > windowMs) { hits.set(key, { t: now, n: 1 }); return false; }
  e.n++;
  return e.n > max;
}
setInterval(() => hits.clear(), 60 * 60 * 1000).unref();

function clientKey(req, prefix) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  return prefix + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function checkPassword(pw) {
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- HTTP ----
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:",
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC_HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 10000) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/ergebnisse': ['ergebnisse.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), type);
    }
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && url.pathname === '/api/antwort') {
      if (limited(clientKey(req, 'a'), 30, 60 * 60 * 1000)) return send(res, 429, { error: 'Zu viele Abgaben.' });
      const a = validate(await readBody(req));
      if (!a) return send(res, 400, { error: 'Bitte alle Pflichtfragen beantworten.' });
      addAntwort(a);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/ergebnisse') {
      if (limited(clientKey(req, 'p'), 10, 15 * 60 * 1000)) return send(res, 429, { error: 'Zu viele Versuche, bitte später erneut.' });
      const { passwort } = await readBody(req);
      if (!checkPassword(passwort)) return send(res, 401, { error: 'Falsches Passwort.' });
      return send(res, 200, { antworten });
    }

    send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    send(res, 400, { error: 'Ungültige Anfrage' });
  }
});

server.listen(PORT, () => console.log(`Umfrage läuft auf Port ${PORT}, ${antworten.length} Antworten geladen`));
