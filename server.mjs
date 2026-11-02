import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(ROOT, 'resume.json');
const SAMPLE_FILE = path.join(ROOT, 'resume.sample.json');
const ASSETS_DIR = path.join(ROOT, 'assets');
const OUTPUT_DIR = path.join(ROOT, '输出');
const PRINT_TEMPLATE = path.join(ROOT, 'print.html');
const DOCX_SCRIPT = path.join(ROOT, 'build_docx.py');
const HOST = '127.0.0.1';
const BASE_PORT = Number(process.env.PORT || 4173);
const BODY_LIMIT = 2 * 1024 * 1024;
const PHOTO_LIMIT = 8 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

let currentRevision = 1;
let lastContent = '';
let lastWriteAt = 0;
let watchTimer = null;
let pythonRuntime;
const clients = new Set();

await fsp.mkdir(ASSETS_DIR, { recursive: true });
await fsp.mkdir(OUTPUT_DIR, { recursive: true });

try {
  lastContent = await fsp.readFile(DATA_FILE, 'utf8');
} catch (err) {
  try {
    const sample = await fsp.readFile(SAMPLE_FILE, 'utf8');
    JSON.parse(sample);
    await fsp.writeFile(DATA_FILE, sample, 'utf8');
    lastContent = sample;
    console.log('[resume] created resume.json from resume.sample.json');
  } catch (sampleErr) {
    console.error('[resume] resume.json is missing and resume.sample.json could not be used:', sampleErr.message);
    process.exit(1);
  }
}

function broadcast(source) {
  const payload = 'event: update\n' +
    'data: ' + JSON.stringify({ revision: currentRevision, source: source || 'external' }) + '\n\n';
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (err) {
      clients.delete(client);
    }
  }
}

function startWatcher() {
  try {
    fs.watch(ROOT, (eventType, filename) => {
      if (!filename) return;
      if (filename.toString() !== 'resume.json') return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(async () => {
        if (Date.now() - lastWriteAt < 500) return;
        try {
          const text = await fsp.readFile(DATA_FILE, 'utf8');
          if (text === lastContent) return;
          JSON.parse(text);
          lastContent = text;
          currentRevision += 1;
          console.log('[resume] external change detected, revision', currentRevision);
          broadcast('external');
        } catch (err) {
          console.warn('[resume] ignored invalid external change:', err.message);
        }
      }, 180);
    });
  } catch (err) {
    console.warn('[resume] file watcher unavailable:', err.message);
  }
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const text = await readBody(req, limit);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw Object.assign(new Error('请求数据不是有效 JSON'), { status: 400 });
  }
}

function validateResume(data) {
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error('简历数据格式错误'), { status: 400 });
  }
  if (!data.profile || typeof data.profile !== 'object') {
    throw Object.assign(new Error('简历数据缺少 profile'), { status: 400 });
  }
  if (!Array.isArray(data.sections)) {
    throw Object.assign(new Error('简历数据缺少 sections'), { status: 400 });
  }
  return data;
}

function safeBase(input) {
  return String(input || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '')
    .replace(/\.+$/g, '')
    .slice(0, 80) || '简历';
}

function outputBase(data) {
  const profile = data.profile || {};
  const parts = [profile.name, profile.title, '简历'].map((part) => String(part || '').trim()).filter(Boolean);
  return safeBase(parts.join('-'));
}

function attachmentHeader(filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename);
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function findEdge() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    process.env.EDGE_PATH,
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function detectPython() {
  if (pythonRuntime !== undefined) return pythonRuntime;
  const candidates = [
    { cmd: 'py', args: ['-3'] },
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] }
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate.cmd, candidate.args.concat(['-c', 'import docx']), {
        timeout: 15000,
        windowsHide: true
      });
      pythonRuntime = candidate;
      return candidate;
    } catch (err) {
      // try next
    }
  }
  pythonRuntime = null;
  return null;
}

async function exportPdf() {
  const edge = findEdge();
  if (!edge) {
    throw Object.assign(new Error('未找到 Microsoft Edge 或 Chrome，无法导出 PDF'), { status: 500 });
  }

  const data = validateResume(JSON.parse(await fsp.readFile(DATA_FILE, 'utf8')));
  const base = outputBase(data);
  const outName = base + '.pdf';
  const outPath = path.join(OUTPUT_DIR, outName);
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const tempHtml = path.join(ROOT, '_print-' + stamp + '.html');
  const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'resume-pdf-'));

  try {
    const template = await fsp.readFile(PRINT_TEMPLATE, 'utf8');
    if (!template.includes('<!--RESUME_DATA-->')) {
      throw new Error('print.html 缺少数据占位符');
    }
    const script = '<script>window.__RESUME_DATA__ = ' + jsonForScript(data) + ';</script>';
    const html = template.replace('<!--RESUME_DATA-->', script);
    await fsp.writeFile(tempHtml, html, 'utf8');
    await fsp.rm(outPath, { force: true });

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      '--allow-file-access-from-files',
      '--virtual-time-budget=5000',
      '--user-data-dir=' + profileDir,
      '--print-to-pdf=' + outPath,
      pathToFileURL(tempHtml).href
    ];

    try {
      await execFileAsync(edge, args, {
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (err) {
      const detail = String(err.stderr || err.stdout || err.message || '').slice(-500);
      throw new Error('Edge 导出 PDF 失败：' + detail);
    }

    const stat = await fsp.stat(outPath).catch(() => null);
    if (!stat || stat.size < 800) {
      throw new Error('PDF 文件没有正确生成');
    }
    const header = (await fsp.readFile(outPath)).subarray(0, 4).toString('latin1');
    if (header !== '%PDF') {
      throw new Error('生成的文件不是有效 PDF');
    }

    return {
      ok: true,
      file: '输出/' + outName,
      url: '/output/' + encodeURIComponent(outName)
    };
  } finally {
    await fsp.rm(tempHtml, { force: true }).catch(() => {});
    await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function exportDocx() {
  const python = await detectPython();
  if (!python) {
    throw Object.assign(new Error('未找到可用的 Python，或未安装 python-docx。请运行：py -m pip install python-docx'), { status: 500 });
  }

  const data = validateResume(JSON.parse(await fsp.readFile(DATA_FILE, 'utf8')));
  const base = outputBase(data);
  const outName = base + '.docx';
  const outPath = path.join(OUTPUT_DIR, outName);

  await fsp.rm(outPath, { force: true });
  try {
    await execFileAsync(python.cmd, python.args.concat([DOCX_SCRIPT, '--out', outPath]), {
      cwd: ROOT,
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || '').slice(-800);
    throw new Error('生成 Word 失败：' + detail);
  }

  const stat = await fsp.stat(outPath).catch(() => null);
  if (!stat || stat.size < 500) {
    throw new Error('Word 文件没有正确生成');
  }

  return {
    ok: true,
    file: '输出/' + outName,
    url: '/output/' + encodeURIComponent(outName)
  };
}

async function exportHtml() {
  const data = validateResume(JSON.parse(await fsp.readFile(DATA_FILE, 'utf8')));
  const standaloneData = JSON.parse(JSON.stringify(data));

  if (standaloneData.profile && standaloneData.profile.photo) {
    const rel = String(standaloneData.profile.photo).split('?')[0];
    const full = path.resolve(ROOT, rel);
    if (full.startsWith(ROOT) && fs.existsSync(full)) {
      const ext = path.extname(full).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const buffer = await fsp.readFile(full);
      standaloneData.profile.photo = 'data:' + mime + ';base64,' + buffer.toString('base64');
    }
  }

  let html = await fsp.readFile(PRINT_TEMPLATE, 'utf8');
  const dataScript = '<script>window.__RESUME_DATA__ = ' + jsonForScript(standaloneData) + ';</script>';
  html = html.replace('<!--RESUME_DATA-->', dataScript);
  html = html.replace('<title>简历</title>', '<title>' + escapeHtml((data.profile.name || '') + ' - 简历') + '</title>');

  const css = await fsp.readFile(path.join(ASSETS_DIR, 'resume.css'), 'utf8');
  html = html.replace('<link rel="stylesheet" href="assets/resume.css">', '<style>\n' + css + '\n</style>');

  const renderer = await fsp.readFile(path.join(ASSETS_DIR, 'renderer.js'), 'utf8');
  html = html.replace('<script src="assets/renderer.js"></script>', '<script>\n' + renderer + '\n</script>');

  const outName = outputBase(data) + '.html';
  const outPath = path.join(OUTPUT_DIR, outName);
  await fsp.writeFile(outPath, html, 'utf8');

  return {
    ok: true,
    file: '输出/' + outName,
    url: '/output/' + encodeURIComponent(outName)
  };
}

async function handlePhoto(req, res) {
  const body = await readJsonBody(req, PHOTO_LIMIT);
  const dataUrl = body && body.dataUrl;
  if (typeof dataUrl !== 'string') {
    throw Object.assign(new Error('缺少图片数据'), { status: 400 });
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) {
    throw Object.assign(new Error('只支持 PNG、JPG、WebP 图片'), { status: 400 });
  }
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error('图片不能超过 5MB'), { status: 413 });
  }

  const filename = 'photo-' + Date.now() + '.' + ext;
  await fsp.writeFile(path.join(ASSETS_DIR, filename), buffer);

  const files = await fsp.readdir(ASSETS_DIR);
  for (const file of files) {
    if (file === filename) continue;
    if (/^photo[-.].*\.(png|jpe?g|webp)$/i.test(file)) {
      await fsp.rm(path.join(ASSETS_DIR, file), { force: true }).catch(() => {});
    }
  }

  sendJson(res, 200, { ok: true, path: 'assets/' + filename });
}

function serveEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  res.write('event: ready\ndata: ' + JSON.stringify({ revision: currentRevision }) + '\n\n');
  clients.add(res);

  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clearInterval(timer);
      clients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(timer);
    clients.delete(res);
  });
}

function resolveStaticPath(pathname) {
  let rel;
  if (pathname === '/') {
    rel = 'index.html';
  } else if (pathname.startsWith('/output/')) {
    rel = path.join('输出', decodeURIComponent(pathname.slice('/output/'.length)));
  } else {
    rel = decodeURIComponent(pathname.replace(/^\/+/, ''));
  }

  const full = path.resolve(ROOT, rel);
  const relative = path.relative(ROOT, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  const parts = relative.split(path.sep);
  if (parts[0] === '.git' || parts[0] === 'node_modules') return null;
  if (relative === 'server.mjs' || relative === 'build_docx.py' || relative === 'start.bat') return null;
  if (path.basename(relative).startsWith('_print-')) return null;
  return full;
}

async function serveStatic(req, res, pathname, url) {
  let full;
  try {
    full = resolveStaticPath(pathname);
  } catch (err) {
    sendJson(res, 400, { error: '路径格式错误' });
    return;
  }
  if (!full) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const stat = await fsp.stat(full).catch(() => null);
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(full).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };

  if (pathname.startsWith('/output/') && url.searchParams.get('download')) {
    headers['Content-Disposition'] = attachmentHeader(path.basename(full));
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(full);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', 'http://' + HOST);
  const pathname = url.pathname;

  if (pathname === '/api/resume') {
    if (req.method === 'GET') {
      const text = await fsp.readFile(DATA_FILE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Revision': String(currentRevision),
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(text);
      return;
    }

    if (req.method === 'PUT') {
      const data = validateResume(await readJsonBody(req, BODY_LIMIT));
      const text = JSON.stringify(data, null, 2) + '\n';
      const temp = DATA_FILE + '.tmp-' + process.pid + '-' + Date.now();
      await fsp.writeFile(temp, text, 'utf8');
      try {
        await fsp.rename(temp, DATA_FILE);
      } catch (err) {
        await fsp.copyFile(temp, DATA_FILE);
        await fsp.rm(temp, { force: true }).catch(() => {});
      }
      lastWriteAt = Date.now();
      lastContent = text;
      currentRevision += 1;
      const source = String(req.headers['x-client-id'] || 'external');
      broadcast(source);
      console.log('[resume] saved, revision', currentRevision);
      sendJson(res, 200, { ok: true, revision: currentRevision });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, PUT' });
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    serveEvents(req, res);
    return;
  }

  if (pathname === '/api/photo' && req.method === 'POST') {
    await handlePhoto(req, res);
    return;
  }

  if (pathname === '/api/export/pdf' && req.method === 'POST') {
    const result = await exportPdf();
    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/export/docx' && req.method === 'POST') {
    const result = await exportDocx();
    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/export/html' && req.method === 'POST') {
    const result = await exportHtml();
    sendJson(res, 200, result);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
    return;
  }

  await serveStatic(req, res, pathname, url);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const status = err && err.status ? err.status : 500;
    console.error('[resume] request failed:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      sendJson(res, status, { error: err && err.message ? err.message : '服务器错误' });
    } else {
      res.end();
    }
  });
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && port < BASE_PORT + 10) {
        server.removeListener('error', onError);
        listen(port + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    };
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.removeListener('error', onError);
      resolve(port);
    });
  });
}

startWatcher();
const port = await listen(BASE_PORT);
const address = 'http://' + HOST + ':' + port + '/';
console.log('[resume] workspace ready: ' + address);

if (!process.argv.includes('--no-open') && process.env.NO_OPEN !== '1') {
  spawn('cmd', ['/c', 'start', '', address], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  }).unref();
}

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
