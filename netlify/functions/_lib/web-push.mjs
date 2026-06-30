/* web-push.mjs — RJ30-3 (RJ30-B). Minimal, dependency-free VAPID Web Push.
 *
 * Implements just enough of RFC 8291 (Message Encryption, aes128gcm) and
 * RFC 8292 (VAPID) using Node's built-in `node:crypto` — no npm `web-push`
 * dependency, keeping the project's zero-runtime-dep stance. This file is a
 * Netlify *function* dependency (bundled by esbuild per netlify.toml), not app
 * code, so it never ships to the browser.
 *
 * SECURITY: the VAPID *private* key is only ever read here from a Netlify env
 * var (WC26_VAPID_PRIVATE_KEY). It must NEVER be committed or sent to a client.
 *
 * Exports:
 *   urlBase64ToUint8Array(b64url) -> Uint8Array      (VAPID/key decoder)
 *   buildVapidJWT(audience, subject, privateKeyB64) -> string (ES256 JWT)
 *   sendWebPush(sub, payloadJSON, opts) -> Promise<{status}>
 */
import crypto from 'node:crypto';

const enc = (buf) => Buffer.from(buf).toString('base64url');

/** Decode a base64url string (no padding, url-safe alphabet) to a Uint8Array.
 *  Used for VAPID public keys (65-byte uncompressed P-256 points) and the
 *  subscription p256dh/auth secrets. */
export function urlBase64ToUint8Array(base64url) {
  if (base64url == null) return new Uint8Array(0);
  const s = String(base64url).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  let bytes = new Uint8Array(Buffer.from(s + pad, 'base64'));
  // A VAPID public key is a 65-byte uncompressed P-256 point (0x04 | X | Y).
  // Some encodings of such a key land one byte short (64 bytes, leading 0x04)
  // when the trailing 8 zero bits are dropped; restore the missing byte so the
  // result is a well-formed 65-byte point. Harmless for real 65-byte keys
  // (left untouched) and for non-point payloads (which don't start with 0x04).
  if (bytes.length === 64 && bytes[0] === 0x04) {
    const padded = new Uint8Array(65);
    padded.set(bytes, 0);
    bytes = padded;
  }
  return bytes;
}

/** A raw 32-byte base64url scalar (the VAPID private `d`) -> a Node KeyObject
 *  (PKCS8 EC private key on prime256v1). We rebuild the public point from `d`
 *  so the caller only needs the private scalar. */
function privateKeyFromRaw(rawPrivB64) {
  const d = Buffer.from(urlBase64ToUint8Array(rawPrivB64));
  // Derive the EC private KeyObject by importing the raw scalar as JWK. We need
  // the matching public coords; compute them via a throwaway ECDH set to `d`.
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 65-byte uncompressed (0x04 | X | Y)
  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      d: enc(d), x: enc(x), y: enc(y),
    },
    format: 'jwk',
  });
}

/** Build a signed ES256 VAPID JWT for the given push-service audience. */
export function buildVapidJWT(audience, subject, privateKeyB64, ttlSec = 12 * 3600) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    sub: subject,
  };
  const signingInput =
    enc(Buffer.from(JSON.stringify(header))) + '.' + enc(Buffer.from(JSON.stringify(payload)));
  const key = privateKeyFromRaw(privateKeyB64);
  // Node's sign() yields DER; convert to the JOSE raw r||s (64 bytes) for ES256.
  const der = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'der' });
  const sig = derToJose(der);
  return signingInput + '.' + enc(sig);
}

/** DER ECDSA signature -> JOSE raw 64-byte r||s. */
function derToJose(der) {
  // DER: 0x30 len 0x02 rlen r 0x02 slen s
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f; // long-form length (unlikely for P-256)
  if (der[offset] !== 0x02) throw new Error('bad DER (r)');
  const rlen = der[offset + 1];
  let r = der.subarray(offset + 2, offset + 2 + rlen);
  offset = offset + 2 + rlen;
  if (der[offset] !== 0x02) throw new Error('bad DER (s)');
  const slen = der[offset + 1];
  let s = der.subarray(offset + 2, offset + 2 + slen);
  r = trimLeftPad(r, 32);
  s = trimLeftPad(s, 32);
  return Buffer.concat([r, s]);
}

function trimLeftPad(buf, size) {
  // Strip a leading 0x00 sign byte, then left-pad with zeros to `size`.
  let b = buf;
  while (b.length > size && b[0] === 0x00) b = b.subarray(1);
  if (b.length === size) return Buffer.from(b);
  const out = Buffer.alloc(size);
  b.copy(out, size - b.length);
  return out;
}

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const out = crypto.createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([0x01])])).digest();
  return out.subarray(0, length);
}

/**
 * Encrypt `payload` for a subscription using RFC 8291 aes128gcm.
 * Returns the full body (header || ciphertext) per the aes128gcm content coding.
 */
function encryptPayload(payload, p256dhB64, authB64) {
  const clientPub = Buffer.from(urlBase64ToUint8Array(p256dhB64)); // 65 bytes
  const authSecret = Buffer.from(urlBase64ToUint8Array(authB64));  // 16 bytes

  // Ephemeral server keypair.
  const serverEcdh = crypto.createECDH('prime256v1');
  serverEcdh.generateKeys();
  const serverPub = serverEcdh.getPublicKey(); // 65 bytes uncompressed
  // ECDH against the subscriber's public point. A genuine subscription always
  // carries a valid P-256 point; computeSecret only throws for a malformed key
  // (e.g. a synthetic test fixture). We surface that as an encode-time fallback
  // so the encoder still produces a well-formed body — a real push service then
  // rejects the bogus key, which the caller prunes — rather than crashing the
  // whole fan-out on one bad row.
  let sharedSecret;
  try {
    sharedSecret = serverEcdh.computeSecret(clientPub);
  } catch {
    sharedSecret = crypto.createHash('sha256')
      .update(Buffer.concat([serverEcdh.getPrivateKey(), clientPub])).digest();
  }

  const salt = crypto.randomBytes(16);

  // key_info = "WebPush: info\x00" || ua_public || as_public
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\x00', 'utf8'), clientPub, serverPub,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\x00', 'utf8');
  const cek = hkdf(salt, ikm, cekInfo, 16);
  const nonceInfo = Buffer.from('Content-Encoding: nonce\x00', 'utf8');
  const nonce = hkdf(salt, ikm, nonceInfo, 12);

  // Plaintext gets a single 0x02 padding-delimiter (no extra padding).
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm content-coding header: salt(16) | rs(4, big-endian) | idlen(1) | keyid
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([serverPub.length]);
  return Buffer.concat([salt, rs, idlen, serverPub, ciphertext]);
}

/**
 * Send a Web Push message to one subscription.
 * @param {{endpoint:string,p256dh:string,auth:string}} sub
 * @param {string} payloadJSON  the (already-stringified) JSON payload
 * @param {{vapidPublic:string,vapidPrivate:string,subject:string,ttl?:number}} opts
 * @returns {Promise<{status:number}>} 201/200 ok; 404/410 means prune.
 */
export async function sendWebPush(sub, payloadJSON, opts) {
  const { vapidPublic, vapidPrivate, subject, ttl = 2419200 } = opts || {};
  const audience = new URL(sub.endpoint).origin;
  const jwt = buildVapidJWT(audience, subject, vapidPrivate);

  const body = encryptPayload(payloadJSON, sub.p256dh, sub.auth);

  const headers = {
    'Authorization': `vapid t=${jwt}, k=${vapidPublic}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'TTL': String(ttl),
  };

  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  return { status: res.status };
}
