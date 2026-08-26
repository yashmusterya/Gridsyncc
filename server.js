const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Load environment variables from .env / .env.local if present
function loadEnv() {
    ['.env', '.env.local'].forEach(file => {
        const fullPath = path.join(__dirname, file);
        if (fs.existsSync(fullPath)) {
            try {
                const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;
                    const idx = trimmed.indexOf('=');
                    if (idx > -1) {
                        const key = trimmed.substring(0, idx).trim();
                        let val = trimmed.substring(idx + 1).trim();
                        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                            val = val.slice(1, -1);
                        }
                        if (!process.env[key]) {
                            process.env[key] = val;
                        }
                    }
                }
            } catch (e) {
                console.error(`Failed to read ${file}:`, e.message);
            }
        }
    });
}
loadEnv();

const apiHandler = require('./api/handler');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json'
};

async function appHandler(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Route API requests
    if (pathname.startsWith('/api/')) {
        let bodyBuffer = '';
        req.on('data', chunk => { bodyBuffer += chunk; });
        req.on('end', async () => {
            if (bodyBuffer) {
                try {
                    req.body = JSON.parse(bodyBuffer);
                } catch (e) {
                    req.body = bodyBuffer;
                }
            } else {
                req.body = {};
            }
            try {
                await apiHandler(req, res);
            } catch (err) {
                console.error('API Error:', err);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
                }
            }
        });
        return;
    }

    // Static file serving
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
        safePath = '/index.html';
    }

    const filePath = path.join(__dirname, safePath);
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Forbidden');
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
}

function createAndStartServer(port) {
    const s = http.createServer(appHandler);
    s.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying port ${port + 1}...`);
            createAndStartServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });
    s.once('listening', () => {
        console.log(`GridSync server running at http://localhost:${port}`);
    });
    s.listen(port);
}

createAndStartServer(PORT);
