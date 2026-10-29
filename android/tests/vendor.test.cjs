const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = path.join(__dirname, '../web');

test('bundled Firebase modules match their pinned provenance hashes', () => {
  const vendor = path.join(base, 'vendor/firebase');
  const files = JSON.parse(fs.readFileSync(path.join(vendor, 'provenance.json')));
  for (const [name, provenance] of Object.entries(files)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(vendor, name))).digest('hex'), provenance.bundledSha256);
  }
});

test('Android startup modules import local bundled SDK files', () => {
  const app = fs.readFileSync(path.join(base, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /from ['"]https:\/\/www\.gstatic\.com/);
  assert.match(app, /from '\/vendor\/firebase\/firebase-auth\.js'/);
  assert.match(app, /GoogleAuthProvider\.credential\(idToken\)/);
  for (const name of ['firebase-auth.js', 'firebase-firestore.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(base, 'vendor/firebase', name), 'utf8'), /from["']https:/);
  }
});
