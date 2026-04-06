require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");
const { MONGO_URI } = require("./config");

async function checkKey() {
  await mongoose.connect(MONGO_URI);
  const testUser = await User.findById("69d3e91ae3d5d90cc8424c94");
  console.log("Test user DB PubKey:", testUser?.ecdhPublicKey.substring(0, 50));
  process.exit();
}
checkKey();
