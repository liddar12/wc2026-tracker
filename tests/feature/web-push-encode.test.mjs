/* web-push-encode.test.mjs — RJ30-3 (RJ30-B). VAPID key decode + the request
   builder in netlify/functions/_lib/web-push.mjs. No real push service is hit;
   we stub globalThis.fetch and assert the request the encoder built. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  urlBase64ToUint8Array,
  buildVapidJWT,
  sendWebPush,
} from '../../netlify/functions/_lib/web-push.mjs';

// A real, well-formed VAPID PUBLIC key (uncompressed P-256 point, base64url).
const VAPID_PUBLIC =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';
// A 32-byte base64url private key (d).
const VAPID_PRIVATE = 'wHN6w0iZ-CnY4vV0YOIeFcbVdQ0WhMmA9oOZxXmHFsM';

test('urlBase64ToUint8Array decodes a VAPID public key to a 65-byte uncompressed point', () => {
  const arr = urlBase64ToUint8Array(VAPID_PUBLIC);
  assert.ok(arr instanceof Uint8Array, 'returns a Uint8Array');
  assert.equal(arr.length, 65, 'P-256 uncompressed point is 65 bytes');
  assert.equal(arr[0], 0x04, 'leading byte is 0x04 (uncompressed)');
});

test('urlBase64ToUint8Array handles missing padding and url-safe chars', () => {
  // 'AAAA' decodes to 3 zero bytes; verify no throw and correct length.
  const arr = urlBase64ToUint8Array('AAAA');
  assert.equal(arr.length, 3);
  assert.deepEqual(Array.from(arr), [0, 0, 0]);
});

test('buildVapidJWT produces a 3-part ES256 JWT with the right alg/aud', () => {
  const jwt = buildVapidJWT('https://fcm.googleapis.com', 'mailto:liddar@gmail.com', VAPID_PRIVATE);
  const parts = jwt.split('.');
  assert.equal(parts.length, 3, 'header.payload.signature');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  assert.equal(header.alg, 'ES256');
  assert.equal(header.typ, 'JWT');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  assert.equal(payload.aud, 'https://fcm.googleapis.com');
  assert.equal(payload.sub, 'mailto:liddar@gmail.com');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000), 'exp in the future');
});

test('sendWebPush builds a VAPID-authorized POST with TTL + encrypted body, treats 201 as ok', async () => {
  const captured = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return { status: 201, ok: true, text: async () => '' };
  };
  try {
    const sub = {
      endpoint: 'https://fcm.googleapis.com/wp/abc123',
      p256dh: 'BNcRpA3l8gYZ8a6m2QfQ4r1m3wQ8m1Z3xV2nC4kS6tU8wX0yA2bD4fH6jK8mN0pR2tV4xZ6bD8fH0jK2mN4pR6',
      auth: 'k8mN0pR2tV4xZ6bD8fH0jA',
    };
    const res = await sendWebPush(sub, JSON.stringify({ title: 'GOAL', body: 'Mexico 1-0' }), {
      vapidPublic: VAPID_PUBLIC,
      vapidPrivate: VAPID_PRIVATE,
      subject: 'mailto:liddar@gmail.com',
    });
    assert.equal(res.status, 201);
    assert.equal(captured.url, sub.endpoint);
    assert.equal(captured.opts.method, 'POST');
    const auth = captured.opts.headers['Authorization'] || captured.opts.headers['authorization'];
    assert.ok(/^vapid /.test(auth), `Authorization should start with 'vapid ': ${auth}`);
    assert.ok(/t=/.test(auth) && /k=/.test(auth), 'vapid header carries t= (JWT) and k= (public key)');
    const ttl = captured.opts.headers['TTL'] || captured.opts.headers['ttl'];
    assert.ok(ttl != null, 'TTL header present');
    assert.equal(captured.opts.headers['Content-Encoding'], 'aes128gcm');
    assert.ok(captured.opts.body && captured.opts.body.length > 0, 'encrypted body is non-empty');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sendWebPush surfaces a 410 status so the caller can prune', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 410, ok: false, text: async () => 'gone' });
  try {
    const sub = {
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      p256dh: 'BNcRpA3l8gYZ8a6m2QfQ4r1m3wQ8m1Z3xV2nC4kS6tU8wX0yA2bD4fH6jK8mN0pR2tV4xZ6bD8fH0jK2mN4pR6',
      auth: 'k8mN0pR2tV4xZ6bD8fH0jA',
    };
    const res = await sendWebPush(sub, JSON.stringify({ title: 't' }), {
      vapidPublic: VAPID_PUBLIC, vapidPrivate: VAPID_PRIVATE, subject: 'mailto:x@y.z',
    });
    assert.equal(res.status, 410);
  } finally {
    globalThis.fetch = realFetch;
  }
});
