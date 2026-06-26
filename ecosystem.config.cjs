// Load .env so PM2 passes all variables to the server process.
// dotenv is a devDependency — install via `npm install -D dotenv` if missing.
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apps: [
    {
      name: 'gemini-web',
      script: './dist/server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || '8080',
        GEMINI_COOKIE: process.env.GEMINI_COOKIE,
        GEMINI_PROXY: process.env.GEMINI_PROXY,
        API_KEYS: process.env.API_KEYS || 'test-key',
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
        RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE || '20',
        GEMINI_DUMP: process.env.GEMINI_DUMP,
      },
      // Restart if memory grows too large (Render free tier has 512 MB)
      max_memory_restart: '400M',
      // Log settings
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/gemini-web-error.log',
      out_file: './logs/gemini-web-out.log',
      merge_logs: true,
      // Graceful shutdown
      kill_timeout: 5000,
    },
  ],
};
