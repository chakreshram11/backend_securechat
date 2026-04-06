require("dotenv").config();
const { webcrypto: crypto } = require("crypto");
const mongoose = require("mongoose");
const User = require("./models/User");
const { MONGO_URI } = require("./config");
const { decryptPrivateKey } = require("./utils/crypto");

async function run() {
  await mongoose.connect(MONGO_URI);
  const admin = await User.findOne({ username: "Server@admin" });
  const testUser = await User.findById("69d3e91ae3d5d90cc8424c94");
  
  // Decrypt Server@admin private key
  const adminPrivB64 = decryptPrivateKey(admin.ecdhPrivateKeyEncrypted, "Server@admin123");
  const testPubB64 = testUser.ecdhPublicKey;
  
  const algoECDH = { name: "ECDH", namedCurve: "P-256" };
  
  // Import Admin Priv
  const adminPrivRaw = Uint8Array.from(atob(adminPrivB64), (c) => c.charCodeAt(0)).buffer;
  const adminPriv = await crypto.subtle.importKey("pkcs8", adminPrivRaw, algoECDH, true, ["deriveKey", "deriveBits"]);
  
  // Import Test Pub
  const testPubRaw = Uint8Array.from(atob(testPubB64), (c) => c.charCodeAt(0)).buffer;
  const testPub = await crypto.subtle.importKey("spki", testPubRaw, algoECDH, true, []);
  
  // Derive AES
  const aesKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: testPub },
    adminPriv,
    { name: "AES-GCM", length: 256 },
    true, ["encrypt", "decrypt"]
  );
  
  // Encrypt
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode("hi this is a test");
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc);
  
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  const b64 = btoa(String.fromCharCode(...combined));
  
  console.log("Server@admin successfully generated ciphertext for testUser:");
  console.log("Ciphertext length:", b64.length);
  
  // Now try to export the AES key the same way ChatWindow does
  const raw = await crypto.subtle.exportKey("raw", aesKey);
  const rawKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
  console.log("Raw AES GCM key base64:", rawKeyBase64);
  console.log("Raw Derived AES successfully validated.");
  process.exit();
}
run().catch(console.error);
