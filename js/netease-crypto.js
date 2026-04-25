/**
 * @module netease-crypto
 * Browser-side Netease weapi encryption (AES-128-ECB + RSA).
 * No external dependencies — uses Web Crypto API for AES blocks.
 */

// --- AES-128 block cipher via Web Crypto (CBC with zero IV = ECB) ---
async function aesBlock(keyBytes, block16) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
  const buf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, block16);
  return new Uint8Array(buf).slice(0, 16);
}

// --- AES-128-ECB with PKCS7 padding ---
async function aesECB(data, keyBytes) {
  const pad = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + pad);
  padded.set(data);
  for (let i = 0; i < pad; i++) padded[data.length + i] = pad;
  const out = new Uint8Array(padded.length);
  for (let off = 0; off < padded.length; off += 16) {
    out.set(await aesBlock(keyBytes, padded.slice(off, off + 16)), off);
  }
  return out;
}

// --- RSA (little-endian, Netease modulus/exp) ---
const N = BigInt(
  '0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725' +
  '152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312' +
  'ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424' +
  'd813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7'
);
const E = 0x10001n;

function rsaLE(msgBytes) {
  const hex = Array.from(msgBytes).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
  let c = 1n, base = BigInt('0x' + hex) % N, exp = E;
  while (exp > 0n) {
    if (exp & 1n) c = (c * base) % N;
    exp >>= 1n;
    base = (base * base) % N;
  }
  let s = c.toString(16);
  while (s.length < 256) s = '0' + s;
  return s;
}

// --- Base64 ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const a = b[i], c = b[i+1] ?? 0, d = b[i+2] ?? 0;
    s += B64[a>>2] + B64[((a&3)<<4)|(c>>4)];
    s += i+1 < b.length ? B64[((c&15)<<2)|(d>>6)] : '=';
    s += i+2 < b.length ? B64[d&63] : '=';
  }
  return s;
}

// --- weapi ---
const PRESET = new TextEncoder().encode('0CoJUm6Qyw8W8jud');
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Encrypt params for Netease weapi.
 * @param {object} obj - request params
 * @returns {Promise<{params: string, encSecKey: string}>}
 */
export async function weapi(obj) {
  const json = JSON.stringify({ ...obj, csrf_token: '' });
  const r = new Uint8Array(16);
  crypto.getRandomValues(r);
  const ks = Array.from(r).map(v => CHARS[v % CHARS.length]).join('');
  const k2 = new TextEncoder().encode(ks);

  const s1 = await aesECB(new TextEncoder().encode(json), PRESET);
  const s2 = await aesECB(s1, k2);
  const esk = rsaLE(new Uint8Array([...k2].reverse()));
  return { params: toB64(s2), encSecKey: esk };
}
