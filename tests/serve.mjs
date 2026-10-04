import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const name = url.pathname === '/' ? '/tests/browser-harness.html' : decodeURIComponent(url.pathname);
        const target = path.resolve(root, '.' + name);
        if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        const data = await readFile(target); res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream'); res.end(data);
    } catch { res.writeHead(404).end(); }
}).listen(8766, '127.0.0.1', () => console.log('UI fixture: http://127.0.0.1:8766'));
