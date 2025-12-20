// Utility to convert between formats used by front-end Web Crypto and Node
const crypto = require('crypto');

function base64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}
function bufferToBase64(buf) {
  return Buffer.from(buf).toString('base64');
}

// Derive AES key from shared secret using HKDF (SHA-256)
function deriveAesKeyFromSharedSecret(sharedSecret, salt = null) {
  // sharedSecret: Buffer
  // returns 32 byte AES key Buffer
  const info = Buffer.from('chat-app-aes-key-derivation');
  const key = crypto.hkdfSync('sha256', sharedSecret, salt, info, 32);
  return key;
}

// Generate ECDH key pair (P-256 curve) compatible with Web Crypto API
// Returns { publicKeyB64, privateKeyB64 } in SPKI/PKCS8 format
function generateECDHKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', // P-256 curve
    publicKeyEncoding: {
      type: 'spki',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der'
    }
  });

  return {
    publicKeyB64: bufferToBase64(publicKey),
    privateKeyB64: bufferToBase64(privateKey)
  };
}

// Encrypt private key using password (not password hash, since bcrypt hashes are non-deterministic)
function encryptPrivateKey(privateKeyB64, password) {
  const algorithm = 'aes-256-gcm';
  // Use PBKDF2 to derive a consistent key from the password
  const salt = Buffer.from('ecdh-key-encryption-salt-v1'); // Fixed salt for consistency
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(privateKeyB64, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return bufferToBase64(combined);
}

// Decrypt private key using password
function decryptPrivateKey(encryptedB64, password) {
  const algorithm = 'aes-256-gcm';
  // Use PBKDF2 to derive the same key from the password
  const salt = Buffer.from('ecdh-key-encryption-salt-v1'); // Same fixed salt
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const combined = base64ToBuffer(encryptedB64);
  
  const iv = combined.slice(0, 16);
  const authTag = combined.slice(16, 32);
  const encrypted = combined.slice(32);
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);
  
  return decrypted.toString('utf8');
}

module.exports = { 
  base64ToBuffer, 
  bufferToBase64, 
  deriveAesKeyFromSharedSecret,
  generateECDHKeyPair,
  encryptPrivateKey,
  decryptPrivateKey
};
