// // Utility to convert between formats used by front-end Web Crypto and Node
// const crypto = require('crypto');

// function base64ToBuffer(b64) {
//   return Buffer.from(b64, 'base64');
// }
// function bufferToBase64(buf) {
//   return Buffer.from(buf).toString('base64');
// }

// // Derive AES key from shared secret using HKDF (SHA-256)
// function deriveAesKeyFromSharedSecret(sharedSecret, salt = null) {
//   // sharedSecret: Buffer
//   // returns 32 byte AES key Buffer
//   const info = Buffer.from('chat-app-aes-key-derivation');
//   const key = crypto.hkdfSync('sha256', sharedSecret, salt, info, 32);
//   return key;
// }

// module.exports = { base64ToBuffer, bufferToBase64, deriveAesKeyFromSharedSecret };

const crypto = require("crypto");

// ---------- base64 helpers ----------
function base64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

function bufferToBase64(buf) {
  return Buffer.from(buf).toString("base64");
}

// ---------- AES encryption ----------
const ALGO = "aes-256-gcm";
const MASTER_KEY = crypto
  .createHash("sha256")
  .update(process.env.KEY_ENCRYPT_SECRET)
  .digest();

function encryptPrivateKey(privateKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, MASTER_KEY, iv);

  let encrypted = cipher.update(privateKey, "utf8", "base64");
  encrypted += cipher.final("base64");

  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted,
  });
}

function decryptPrivateKey(enc) {
  const { iv, tag, data } = JSON.parse(enc);

  const decipher = crypto.createDecipheriv(
    ALGO,
    MASTER_KEY,
    Buffer.from(iv, "base64")
  );

  decipher.setAuthTag(Buffer.from(tag, "base64"));

  let decrypted = decipher.update(data, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

module.exports = {
  base64ToBuffer,
  bufferToBase64,
  encryptPrivateKey,
  decryptPrivateKey,
};
