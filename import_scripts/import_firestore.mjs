/**
 * AkashLang Firestore bulk importer.
 * Reads OAuth token from firebase-tools' config (no token written anywhere new).
 * Run: node import_firestore.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, '..');
const PROJECT_ID = 'akashlang-a9d4b';
const FS_BASE    = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BATCH_URL  = `${FS_BASE}:batchWrite`;
const BATCH_SIZE = 499;

// Firebase CLI OAuth2 client (native app — client_secret is not secret per RFC 8252;
// these values are embedded in the public firebase-tools npm package source).
const FB_CLI_CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const FB_CLI_CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

// ── Auth ──────────────────────────────────────────────────────────────────────

function readFbConfig() {
  const candidates = [
    join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json'),
    join(homedir(), '.config', 'configstore', 'firebase-tools.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      return cfg;
    }
  }
  return null;
}

async function getAccessToken() {
  const cfg = readFbConfig();
  if (!cfg?.tokens) throw new Error('Not logged in. Run: firebase login');

  const { access_token, refresh_token, expiry_date } = cfg.tokens;
  const isExpired = expiry_date && Date.now() >= expiry_date - 60_000;

  if (access_token && !isExpired) {
    return access_token;
  }

  if (!refresh_token) throw new Error('No refresh token. Run: firebase login');

  // Refresh the access token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     FB_CLI_CLIENT_ID,
      client_secret: FB_CLI_CLIENT_SECRET,
      refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Firestore conversion ──────────────────────────────────────────────────────

function toFsValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean')          return { booleanValue: val };
  if (typeof val === 'number')
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === 'string')           return { stringValue: val };
  if (Array.isArray(val))                return { arrayValue: { values: val.map(toFsValue) } };
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) fields[k] = toFsValue(v);
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function apiFetch(url, options, token) {
  const resp = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 600)}`);
  }
  return resp.json();
}

async function batchWrite(writes, token) {
  return apiFetch(BATCH_URL, { method: 'POST', body: JSON.stringify({ writes }) }, token);
}

async function deleteByPrefix(collection, prefix, token) {
  let pageToken = '';
  let totalDeleted = 0;
  do {
    const url = `${FS_BASE}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const data = await apiFetch(url, { method: 'GET' }, token);
    const docs = (data.documents || []).filter(d => d.name.split('/').pop().startsWith(prefix));
    if (docs.length > 0) {
      for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        await batchWrite(docs.slice(i, i + BATCH_SIZE).map(d => ({ delete: d.name })), token);
      }
      totalDeleted += docs.length;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  if (totalDeleted > 0) console.log(`  Removed ${totalDeleted} old doc(s)`);
}

async function importCollection(collection, records, docIdFn, deletePrefix, token) {
  console.log(`\n→ [${collection}] — ${records.length} records`);
  if (deletePrefix) await deleteByPrefix(collection, deletePrefix, token);

  const batches = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) batches.push(records.slice(i, i + BATCH_SIZE));

  let written = 0;
  for (let bi = 0; bi < batches.length; bi++) {
    const writes = batches[bi].map((rec, li) => {
      const docId = docIdFn(rec, bi * BATCH_SIZE + li);
      const fields = {};
      for (const [k, v] of Object.entries(rec)) fields[k] = toFsValue(v);
      return { update: { name: `projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`, fields } };
    });
    await batchWrite(writes, token);
    written += batches[bi].length;
    process.stdout.write(`  ${written}/${records.length} written\r`);
  }
  console.log(`  ✓ ${written} documents imported              `);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== AkashLang Firestore Importer ===');
  console.log(`Project: ${PROJECT_ID}\n`);

  const token = await getAccessToken();
  console.log('✓ Auth token obtained\n');

  const words     = JSON.parse(readFileSync(join(DATA_DIR, 'joylang_words.json'),     'utf8'));
  const sentences = JSON.parse(readFileSync(join(DATA_DIR, 'joylang_sentences.json'), 'utf8'));
  const phrases   = JSON.parse(readFileSync(join(DATA_DIR, 'phrases.json'),           'utf8'));
  const clauses   = JSON.parse(readFileSync(join(DATA_DIR, 'clauses.json'),           'utf8'));

  console.log(`Data: ${words.length} words · ${sentences.length} sentences · ${phrases.length} phrases · ${clauses.length} clauses`);

  await importCollection('words',     words,     (_, i) => `lexicon_${String(i+1).padStart(6,'0')}`, 'lexicon_', token);
  await importCollection('sentences', sentences, (_, i) => `lexicon_${String(i+1).padStart(6,'0')}`, 'lexicon_', token);
  await importCollection('phrases',   phrases,   r      => `phrase_${r.id}`,                         'phrase_',  token);
  await importCollection('clauses',   clauses,   r      => `clause_${r.id}`,                         'clause_',  token);

  console.log('\n✓ Import complete!');
}

main().catch(e => { console.error('\n✗ Error:', e.message); process.exit(1); });
