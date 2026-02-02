require('dotenv').config({ path: __dirname + '/.env' });

module.exports = {
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET || "replace_with_strong_jwt_secret"
};
