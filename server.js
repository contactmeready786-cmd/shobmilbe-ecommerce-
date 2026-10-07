'use strict';
// Local development server: `npm start`, then open http://localhost:3000
// Needs DATABASE_URL in the environment (or in a .env file next to this one).
const http = require('http');
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { handler } = require('./lib/app');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(PUBLIC, urlPath);
  if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    return fs.createReadStream(file).pipe(res);
  }
  handler(req, res);
}).listen(process.env.PORT || 3000, () => console.log(`Running on http://localhost:${process.env.PORT || 3000}`));
