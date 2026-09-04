// 零依赖静态文件服务器：用于本地游玩打包后的 dist/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const port = process.env.PORT || 8137;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const path = (req.url ?? '/').split(/[?#]/)[0] || '/';
  const file = path === '/' ? '/index.html' : path;
  try {
    const data = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(port, () => {
  console.log(`事件视界已启动: http://localhost:${port}`);
});
