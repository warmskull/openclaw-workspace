const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const uploadDir = path.join(root, 'uploads');
const chunkRoot = path.join(uploadDir, '_chunks');
const port = process.env.PORT || 4173;

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(chunkRoot)) fs.mkdirSync(chunkRoot, { recursive: true });

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.zip': 'application/zip'
};

function sanitizeFilename(name = 'upload.bin') {
  return path.basename(name).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
}

function readBody(req, maxBytes = 300 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('文件过大（>300MB）'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

http
  .createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://localhost');
    const urlPath = decodeURIComponent(reqUrl.pathname);

    try {
      // 旧：一次性上传（适合小文件）
      if (req.method === 'POST' && urlPath === '/upload') {
        const rawName = reqUrl.searchParams.get('filename') || req.headers['x-filename'] || `upload_${Date.now()}.bin`;
        const filename = sanitizeFilename(String(rawName));
        const savePath = path.join(uploadDir, filename);
        const buf = await readBody(req);
        fs.writeFileSync(savePath, buf);
        return sendJson(res, 200, { ok: true, filename, bytes: buf.length, path: `/uploads/${filename}` });
      }

      // 分片上传：写入单片
      if (req.method === 'POST' && urlPath === '/upload/chunk') {
        const rawName = reqUrl.searchParams.get('filename') || `upload_${Date.now()}.bin`;
        const filename = sanitizeFilename(String(rawName));
        const index = Number(reqUrl.searchParams.get('index') || '0');
        const total = Number(reqUrl.searchParams.get('total') || '1');
        if (!Number.isInteger(index) || index < 0) return sendJson(res, 400, { ok: false, error: 'index 无效' });
        if (!Number.isInteger(total) || total <= 0) return sendJson(res, 400, { ok: false, error: 'total 无效' });

        const dir = path.join(chunkRoot, filename);
        fs.mkdirSync(dir, { recursive: true });

        const buf = await readBody(req, 50 * 1024 * 1024); // 单片限制 50MB
        fs.writeFileSync(path.join(dir, `${index}.part`), buf);
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ total, filename }, null, 2));
        return sendJson(res, 200, { ok: true, filename, index, total, bytes: buf.length });
      }

      // 分片上传：合并
      if (req.method === 'POST' && urlPath === '/upload/finish') {
        const rawName = reqUrl.searchParams.get('filename') || '';
        const filename = sanitizeFilename(String(rawName));
        if (!filename) return sendJson(res, 400, { ok: false, error: 'filename 不能为空' });

        const dir = path.join(chunkRoot, filename);
        if (!fs.existsSync(dir)) return sendJson(res, 404, { ok: false, error: '未找到分片目录' });

        const metaPath = path.join(dir, 'meta.json');
        const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { total: 0 };
        const total = Number(meta.total || 0);
        if (!total) return sendJson(res, 400, { ok: false, error: '缺少分片元信息' });

        const savePath = path.join(uploadDir, filename);
        const out = fs.createWriteStream(savePath);
        let merged = 0;

        for (let i = 0; i < total; i++) {
          const part = path.join(dir, `${i}.part`);
          if (!fs.existsSync(part)) {
            out.close();
            return sendJson(res, 400, { ok: false, error: `缺少分片 ${i}/${total}` });
          }
          const data = fs.readFileSync(part);
          out.write(data);
          merged += data.length;
        }
        out.end();

        // 清理分片
        for (let i = 0; i < total; i++) {
          const part = path.join(dir, `${i}.part`);
          if (fs.existsSync(part)) fs.unlinkSync(part);
        }
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        fs.rmdirSync(dir);

        return sendJson(res, 200, { ok: true, filename, bytes: merged, path: `/uploads/${filename}` });
      }

      let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404);
          return res.end('Not found');
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message || 'unknown error' });
    }
  })
  .listen(port, () => {
    console.log(`晚饭吃什么 running on http://0.0.0.0:${port}`);
  });
