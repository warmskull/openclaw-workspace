const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const multer = require('multer');

const app = express();

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '.env'));

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '391176';
if (!/^\d{6}$/.test(LOGIN_PASSWORD)) {
  console.error('Invalid LOGIN_PASSWORD. Please set a 6-digit number in .env');
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.PORT || 80);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 443);
const FORCE_HTTPS = String(process.env.FORCE_HTTPS || '').toLowerCase() === 'true';
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || '/etc/letsencrypt/live/juchen.me/fullchain.pem';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || '/etc/letsencrypt/live/juchen.me/privkey.pem';

// 晚饭应用资源（复用既有项目数据与图片）
const DINNER_APP_DIR = '/root/.openclaw/workspace/dinner-what-to-eat';
const DINNER_DISHES_FILE = path.join(DINNER_APP_DIR, 'data', 'dishes.json');
const DINNER_CANDIDATES_FILE = path.join(DINNER_APP_DIR, 'data', 'dish-split-candidates.json');

function loadJsonArray(filePath, label) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error(`[WARN] Failed to load ${label}:`, err.message);
    return [];
  }
}

function saveJsonArray(filePath, arr) {
  const normalized = Array.isArray(arr) ? arr : [];
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}

function loadDinnerDishes() {
  return loadJsonArray(DINNER_DISHES_FILE, 'dinner dishes');
}

function saveDinnerDishes(dishes) {
  saveJsonArray(DINNER_DISHES_FILE, dishes);
}

function loadDinnerCandidates() {
  return loadJsonArray(DINNER_CANDIDATES_FILE, 'dish split candidates');
}

function saveDinnerCandidates(candidates) {
  saveJsonArray(DINNER_CANDIDATES_FILE, candidates);
}

function analyzeCandidateRecord(item) {
  const next = { ...(item || {}) };
  const bbox = Array.isArray(next.bbox) ? next.bbox.map(Number) : [];
  const x1 = bbox[0] || 0;
  const y1 = bbox[1] || 0;
  const x2 = bbox[2] || 0;
  const y2 = bbox[3] || 0;
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const area = width * height;
  const conf = Number(next.confidence || 0);
  const ratio = height ? width / height : 0;
  const reasons = [];

  if (width && width < 420) reasons.push('裁剪过窄');
  if (height && height < 260) reasons.push('裁剪过矮');
  if (area && area < 250000) reasons.push('面积过小');
  if (conf && conf < 0.18) reasons.push('检测置信度过低');
  if (ratio && (ratio > 3.2 || ratio < 0.45)) reasons.push('长宽比异常');

  const autoCategory = reasons.length ? '其他' : (next.category || '主菜');
  const tags = Array.isArray(next.tags) ? [...new Set(next.tags.map(x => String(x).trim()).filter(Boolean))] : [];
  if (!tags.includes('自动分析')) tags.push('自动分析');
  if (autoCategory === '其他' && !tags.includes('非单道菜候选')) tags.push('非单道菜候选');

  return {
    ...next,
    sourceType: 'candidate',
    sourceLabel: 'YOLO候选',
    width,
    height,
    area,
    thumbPhoto: mapDishThumbUrl(next.photo).replace('/dinner-assets', ''),
    autoCategory,
    category: autoCategory,
    autoAnalysis: reasons.length ? `自动判定为“其他”：${reasons.join('、')}` : '自动判定为单道菜候选',
    tags,
  };
}

function loadManagedDishes() {
  const dishes = loadDinnerDishes().map(d => ({
    ...d,
    sourceType: 'dish',
    sourceLabel: '正式菜品',
    thumbPhoto: mapDishThumbUrl(d.photo).replace('/dinner-assets', ''),
    autoCategory: d.category || '',
    autoAnalysis: d.needsConfirm ? '已入正式菜库，但仍待人工确认' : '正式菜品数据',
  }));
  const candidates = loadDinnerCandidates().map(analyzeCandidateRecord);
  return [...dishes, ...candidates];
}

function parseListField(input) {
  if (Array.isArray(input)) return input.map(x => String(x).trim()).filter(Boolean);
  return String(input || '').split(/\n|,/).map(x => x.trim()).filter(Boolean);
}

function mapDishPhotoUrl(photo) {
  if (!photo || typeof photo !== 'string') return '';
  const normalized = photo.startsWith('/') ? photo : `/${photo}`;
  return `/dinner-assets${normalized}`;
}

function mapDishThumbUrl(photo) {
  if (!photo || typeof photo !== 'string') return '';
  const normalized = photo.startsWith('/') ? photo : `/${photo}`;
  const rel = normalized.replace(/^\/+/, '');
  const thumbAbs = path.join(DINNER_APP_DIR, 'generated', 'thumbs', rel);
  if (fs.existsSync(thumbAbs)) {
    return `/dinner-assets/generated/thumbs/${rel}`;
  }
  return mapDishPhotoUrl(photo);
}

function dinnerDishHasPhotoFile(dish) {
  if (!dish || !dish.photo) return false;
  const rel = dish.photo.replace(/^\/+/, '');
  const abs = path.join(DINNER_APP_DIR, rel);
  return fs.existsSync(abs);
}

// 确保上传目录存在
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 配置 multer 用于文件上传（支持大文件）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // 保留原始文件名（支持中文）
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, originalName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 300 * 1024 * 1024 // 300MB 限制
  }
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  if (!req.path.startsWith('/dinner-assets/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});

// 暴露晚饭项目静态资源（图片等）
app.use('/dinner-assets', express.static(DINNER_APP_DIR));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function loginPage(hasError = false) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>给你的礼物</title>
  <style>
    :root {
      --bg1:#fff8f4;
      --bg2:#fff1e6;
      --card:#fffdfb;
      --text:#47312b;
      --muted:#8f7a72;
      --accent:#ff8c6b;
      --accent2:#f7b267;
      --line:#f2dfd1;
      --danger:#d94841;
      --gold:rgba(247,178,103,.38);
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
      background:
        radial-gradient(circle at 15% 20%, rgba(255,185,164,.45), transparent 28%),
        radial-gradient(circle at 82% 14%, rgba(247,178,103,.28), transparent 24%),
        radial-gradient(circle at 80% 88%, rgba(255,213,186,.35), transparent 30%),
        linear-gradient(155deg, var(--bg1), var(--bg2));
      padding:22px 14px calc(24px + env(safe-area-inset-bottom));
      color:var(--text);
      overflow:hidden;
    }
    body::before,
    body::after {
      content:'';
      position:fixed;
      inset:auto;
      width:220px;
      height:220px;
      border-radius:999px;
      background:radial-gradient(circle, var(--gold), transparent 68%);
      filter:blur(2px);
      pointer-events:none;
      animation: float 7s ease-in-out infinite;
    }
    body::before { top:40px; left:-40px; }
    body::after { right:-50px; bottom:10px; animation-delay:1.5s; }
    @keyframes float {
      0%,100% { transform:translateY(0px); }
      50% { transform:translateY(-10px); }
    }
    .card {
      position:relative;
      width:min(92vw, 420px);
      background:rgba(255,253,251,.92);
      border:1px solid var(--line);
      border-radius:28px;
      padding:26px 20px 20px;
      box-shadow:0 22px 48px rgba(190,123,85,.18);
      backdrop-filter: blur(8px);
    }
    .gift {
      width:64px;
      height:64px;
      border-radius:18px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:30px;
      background:linear-gradient(135deg, rgba(255,140,107,.16), rgba(247,178,103,.26));
      border:1px solid rgba(255,140,107,.16);
      margin-bottom:14px;
    }
    .eyebrow {
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:7px 12px;
      border-radius:999px;
      font-size:12px;
      color:#9b6d52;
      background:#fff6ef;
      border:1px solid #f5ddcb;
      margin-bottom:14px;
    }
    h1 {
      margin:0;
      font-size:30px;
      line-height:1.25;
      letter-spacing:-0.02em;
    }
    .sub {
      margin:12px 0 16px;
      color:var(--muted);
      font-size:15px;
      line-height:1.7;
    }
    .promise {
      margin-bottom:14px;
      padding:12px 14px;
      border-radius:16px;
      background:#fff8f2;
      border:1px dashed #f1d8c6;
      color:#7b665f;
      font-size:13px;
      line-height:1.6;
    }
    .err {
      color:var(--danger);
      font-size:13px;
      background:#fff1f0;
      border:1px solid #ffd2cf;
      border-radius:12px;
      padding:9px 11px;
      margin-bottom:12px;
    }
    .field {
      width:100%;
      padding:14px 15px;
      border:1px solid #ead7ca;
      border-radius:14px;
      font-size:17px;
      letter-spacing:.12em;
      text-align:center;
      background:#fffdfa;
      outline:none;
      transition:border-color .2s, box-shadow .2s, transform .2s;
    }
    .field:focus {
      border-color:#ff9a7f;
      box-shadow:0 0 0 4px rgba(255,122,89,.12);
      transform:translateY(-1px);
    }
    .btn {
      margin-top:12px;
      width:100%;
      padding:14px;
      border:0;
      border-radius:14px;
      background:linear-gradient(90deg, var(--accent), var(--accent2));
      color:#fff;
      font-size:16px;
      font-weight:700;
      cursor:pointer;
      box-shadow:0 12px 24px rgba(255,140,107,.24);
    }
    .hint {
      margin-top:12px;
      text-align:center;
      font-size:12px;
      color:#a08f88;
      line-height:1.6;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="gift">🎁</div>
    <div class="eyebrow">给你的 · 小小网站礼物</div>
    <h1>给你的，<br/>一个小小的网站礼物</h1>
    <div class="sub">
      它现在还在慢慢长大，<br/>
      但从今天开始，你已经可以来这里收小惊喜了。
    </div>
    <div class="promise">先从今天吃什么开始，之后这里还会慢慢装进更多属于你的小惊喜。</div>
    ${hasError ? '<div class="err">密码不对哦，再试一次，就能拆开这份礼物啦。</div>' : ''}
    <form method="post" action="/login">
      <input class="field" type="password" name="password" placeholder="输入密码，拆开这份礼物" maxlength="6" inputmode="numeric" required />
      <button class="btn" type="submit">打开礼物</button>
    </form>
    <div class="hint">这是一个只属于你的入口 ✨</div>
  </div>
</body>
</html>`;
}

function homePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>你的小世界 · V2</title>
  <style>
    :root {
      --bg: oklch(0.978 0.01 48);
      --bg2: oklch(0.955 0.022 38);
      --card: rgba(255,255,255,.76);
      --text: oklch(0.28 0.03 28);
      --muted: oklch(0.56 0.02 28);
      --line: rgba(161, 113, 87, .14);
      --accent: oklch(0.72 0.16 42);
      --accent2: oklch(0.82 0.13 74);
      --soft: rgba(255, 245, 238, .82);
      --shadow: 0 24px 60px rgba(142, 96, 72, .14);
      --radius: 28px;
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      min-height:100vh;
      font-family: Inter, 'PingFang SC', 'Segoe UI', sans-serif;
      color:var(--text);
      background:
        radial-gradient(circle at 12% 10%, rgba(255,176,135,.38), transparent 24%),
        radial-gradient(circle at 88% 12%, rgba(247,178,103,.22), transparent 22%),
        radial-gradient(circle at 82% 82%, rgba(255,221,203,.55), transparent 28%),
        linear-gradient(160deg, var(--bg), var(--bg2));
      padding:20px 14px calc(28px + env(safe-area-inset-bottom));
    }
    .wrap { max-width:1040px; margin:0 auto; }
    .topbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:16px; }
    .brand { display:flex; align-items:center; gap:12px; font-weight:700; color:#8f654e; letter-spacing:.01em; }
    .brand .icon {
      width:44px; height:44px; border-radius:16px; display:flex; align-items:center; justify-content:center; font-size:20px;
      background:linear-gradient(135deg, rgba(255,140,107,.18), rgba(247,178,103,.32)); border:1px solid rgba(255,140,107,.16);
      box-shadow:0 10px 24px rgba(255,140,107,.18);
    }
    .logout {
      text-decoration:none; color:#7f6d67; border:1px solid var(--line); padding:10px 14px; border-radius:999px; background:rgba(255,255,255,.65); backdrop-filter:blur(10px);
    }
    .hero {
      position:relative; overflow:hidden; background:linear-gradient(145deg, rgba(255,255,255,.78), rgba(255,248,243,.9)); border:1px solid rgba(255,255,255,.6); border-radius:var(--radius); padding:28px 22px; box-shadow:var(--shadow); backdrop-filter:blur(18px);
    }
    .hero::after {
      content:''; position:absolute; right:-60px; top:-50px; width:220px; height:220px; border-radius:999px; background:radial-gradient(circle, rgba(255,176,135,.38), transparent 62%);
    }
    .hero-badge {
      display:inline-flex; align-items:center; gap:8px; padding:8px 13px; border-radius:999px; background:rgba(255,255,255,.72); border:1px solid rgba(255,176,135,.28); color:#8d614b; font-size:12px; margin-bottom:14px; backdrop-filter:blur(8px);
    }
    h1 { margin:0; font-size:40px; line-height:1.08; letter-spacing:-0.03em; max-width:700px; }
    .hero p { margin:14px 0 0; color:var(--muted); font-size:15px; line-height:1.8; max-width:620px; }
    .cards { margin-top:18px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:16px; }
    .card {
      display:block; text-decoration:none; color:inherit; background:var(--card); border:1px solid rgba(255,255,255,.55); border-radius:24px; padding:20px; box-shadow:0 18px 38px rgba(184,127,92,.08); backdrop-filter:blur(16px); transition:transform .18s ease, box-shadow .2s ease, border-color .2s ease;
    }
    .card:hover { transform:translateY(-3px); box-shadow:0 24px 44px rgba(184,127,92,.13); border-color:rgba(255,140,107,.25); }
    .card .icon { font-size:30px; margin-bottom:12px; }
    .card h2 { margin:0; font-size:20px; letter-spacing:-0.02em; }
    .card p { margin:9px 0 0; font-size:14px; line-height:1.7; color:var(--muted); }
    .footer-note {
      margin-top:16px; background:var(--soft); border:1px solid rgba(255,176,135,.18); border-radius:20px; padding:16px; color:#856e66; font-size:13px; line-height:1.75; backdrop-filter:blur(10px);
    }
    @media (max-width:640px) {
      h1 { font-size:30px; }
      .cards { grid-template-columns:1fr; }
      .hero { padding:24px 18px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand"><div class="icon">✨</div><span>你的小世界</span></div>
      <a class="logout" href="/logout">退出登录</a>
    </div>

    <section class="hero">
      <div class="hero-badge">欢迎回来 · 专属小站 V2</div>
      <h1>欢迎来到一个会慢慢长大的小世界</h1>
      <p>这里不只是一个网页入口，而更像一份正在持续更新的礼物。今天先从晚饭、惊喜和回忆开始，后面会继续长出更多真正属于你们的功能角落。</p>
    </section>

    <section class="cards">
      <a class="card" href="/dinner">
        <div class="icon">🍽️</div>
        <h2>晚饭吃什么</h2>
        <p>不知道今晚吃什么的时候，来这里碰碰运气，快速做决定。</p>
      </a>
      <a class="card" href="/surprise">
        <div class="icon">🎁</div>
        <h2>今日惊喜</h2>
        <p>今天给你准备了一点小小的开心，先留一个温柔入口。</p>
      </a>
      <a class="card" href="/gallery">
        <div class="icon">📷</div>
        <h2>回忆相册</h2>
        <p>把值得记住的瞬间慢慢收进来，以后打开就是我们的回忆。</p>
      </a>
      <a class="card" href="/letter">
        <div class="icon">💌</div>
        <h2>想对你说</h2>
        <p>有些话想认真留给你看，这里以后会变成专属留言角落。</p>
      </a>
      <a class="card" href="/manage-dishes">
        <div class="icon">🗂️</div>
        <h2>菜品管理</h2>
        <p>直接维护菜名、材料、营养、制作时间和图片信息，为后面的套餐推荐做准备。</p>
      </a>
    </section>

    <div class="footer-note">第一版已经上线啦：先放 4 个入口。后面还可以继续长出旅行计划、愿望清单、电影推荐、节日惊喜等更多页面。</div>
  </div>
</body>
</html>`;
}

function dinnerPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>晚饭吃什么 · V2</title>
  <style>
    :root {
      --bg: oklch(0.978 0.012 44);
      --bg2: oklch(0.955 0.022 34);
      --card: rgba(255,255,255,.78);
      --text: oklch(0.28 0.03 28);
      --muted: oklch(0.56 0.02 28);
      --line: rgba(161, 113, 87, .14);
      --accent: oklch(0.72 0.16 42);
      --accent2: oklch(0.82 0.13 74);
      --soft: rgba(255, 246, 239, .84);
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',Roboto,sans-serif;
      color:var(--text);
      background:linear-gradient(160deg, var(--bg), var(--bg2));
      min-height:100vh;
      padding:18px 14px calc(24px + env(safe-area-inset-bottom));
    }
    .wrap { max-width:720px; margin:0 auto; }
    .topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .nav-left { display:flex; gap:8px; flex-wrap:wrap; }
    .nav-link, .logout {
      text-decoration:none; color:#8a7770; border:1px solid var(--line); padding:10px 14px; border-radius:12px; background:rgba(255,255,255,.78); font-size:14px;
    }
    .card {
      background:var(--card);
      border:1px solid rgba(255,255,255,.55);
      border-radius:28px;
      padding:24px 20px;
      box-shadow:0 22px 48px rgba(184,127,92,.12);
      backdrop-filter:blur(16px);
    }
    .eyebrow {
      display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:999px; background:#fff6ef; border:1px solid #f4dbc8; color:#96654d; font-size:12px; margin-bottom:12px;
    }
    h1 { margin:0; font-size:30px; line-height:1.22; }
    .sub { margin-top:10px; color:var(--muted); font-size:15px; line-height:1.7; }
    .dish {
      margin-top:16px; font-size:26px; font-weight:700; color:#d45115; text-align:center; padding:16px 14px; background:#fff6ee; border:1px dashed #ffd7bf; border-radius:18px; min-height:72px; display:flex; align-items:center; justify-content:center;
    }
    .photo-wrap {
      margin-top:14px; border-radius:18px; overflow:hidden; border:1px solid #f0dfd3; background:#fff; min-height:200px; display:flex; align-items:center; justify-content:center; position:relative;
    }
    .photo-wrap::before {
      content:''; position:absolute; inset:0;
      background:linear-gradient(110deg, rgba(255,244,236,.9) 8%, rgba(255,255,255,.95) 18%, rgba(255,244,236,.9) 33%);
      background-size:200% 100%; animation: shimmer 1.5s infinite;
    }
    .photo-wrap.loaded::before { display:none; }
    .photo-wrap.empty { color:#b49b8f; font-size:14px; padding:24px 16px; text-align:center; line-height:1.7; }
    .photo { width:100%; display:block; max-height:420px; object-fit:cover; filter:blur(18px); transform:scale(1.04); opacity:.72; transition:filter .6s ease, transform .6s ease, opacity .6s ease; position:relative; z-index:1; }
    .photo.loaded { filter:blur(0); transform:scale(1); opacity:1; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .meta {
      margin-top:12px; color:#8a7a7a; font-size:14px; text-align:center; line-height:1.6;
    }
    .reason {
      margin-top:12px; background:var(--soft); border:1px solid #f3dfd0; border-radius:16px; padding:14px; color:#745f58; font-size:14px; line-height:1.7;
    }
    .actions { display:flex; gap:10px; margin-top:16px; }
    .btn {
      flex:1; border:0; border-radius:14px; padding:13px 10px; font-size:16px; font-weight:600; cursor:pointer;
    }
    .btn.primary { background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; box-shadow:0 12px 22px rgba(255,140,107,.22); }
    .btn.ghost { background:#fff; border:1px solid var(--line); color:#7a6a6a; }
    .chips { margin-top:15px; display:flex; flex-wrap:wrap; gap:8px; justify-content:center; }
    .chip {
      border:1px solid var(--line); background:#fff; color:#6e5e5e; border-radius:999px; padding:7px 11px; font-size:13px;
    }
    @media (max-width:460px){
      h1{font-size:26px;}
      .dish{font-size:23px;}
      .actions{flex-direction:column;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="nav-left">
        <a class="nav-link" href="/">← 返回首页</a>
      </div>
      <a class="logout" href="/logout">退出登录</a>
    </div>

    <div class="card">
      <div class="eyebrow">今晚吃什么 · V2</div>
      <h1>今晚这顿，帮你更轻松地决定</h1>
      <div class="sub">当你不想纠结的时候，就把决定权先交给我。我会从现有菜品里给你一个带图片的直觉答案，让晚饭选择更轻一点。</div>

      <div id="dish" class="dish">点击“帮我选晚饭”开始</div>
      <div id="photoWrap" class="photo-wrap empty">选一道菜后，这里会显示对应的饭菜图片，帮你更快判断今天有没有想吃它。</div>
      <div id="meta" class="meta"></div>
      <div id="reason" class="reason">这里会显示一句推荐理由，比如“看起来很下饭”“准备时间不长”“适合今天轻松做决定”。</div>

      <div class="actions">
        <button class="btn primary" onclick="pickDish()">帮我选晚饭</button>
        <button class="btn ghost" onclick="pickAgain()">换一道看看</button>
      </div>

      <div class="chips">
        <span class="chip">不纠结</span>
        <span class="chip">看图做决定</span>
        <span class="chip">今晚吃点好的</span>
        <span class="chip">轻松选一顿</span>
      </div>
    </div>
  </div>

  <script>
    function bindProgressiveImages(root) {
      (root || document).querySelectorAll('img.js-blur-up').forEach(function(img) {
        if (img.dataset.bound === '1') return;
        img.dataset.bound = '1';
        function done() {
          img.classList.add('loaded');
          var shell = img.closest('.image-shell, .photo-wrap');
          if (shell) shell.classList.add('loaded');
        }
        if (img.complete) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }
      });
    }

    function buildReason(dish) {
      const lines = [];
      if (dish.category) lines.push('今天这道偏「' + dish.category + '」风格，适合换个口味。');
      if (dish.prepTimeMin) lines.push('准备时间大约 ' + dish.prepTimeMin + ' 分钟，不用花太久做决定。');
      if (dish.caloriesKcal) lines.push('热量大约 ' + dish.caloriesKcal + ' kcal，可以顺手当作一个轻参考。');
      if (!lines.length) return '这道菜看起来挺像今晚的答案，先从它开始想象一下晚饭的样子吧。';
      return lines.slice(0, 2).join(' ');
    }

    async function pickDish() { await fetchAndRenderDish(); }
    async function pickAgain() { await fetchAndRenderDish(); }

    async function fetchAndRenderDish() {
      const dishEl = document.getElementById('dish');
      const photoWrapEl = document.getElementById('photoWrap');
      const metaEl = document.getElementById('meta');
      const reasonEl = document.getElementById('reason');

      dishEl.textContent = '正在帮你挑今天的晚饭...';
      metaEl.textContent = '';
      reasonEl.textContent = '我正在从现有菜品里挑一个比较合适的灵感给你。';

      try {
        const res = await fetch('/api/dinner/random', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '获取推荐失败');

        const dish = data.dish;
        dishEl.textContent = dish.name || '今晚吃这个';
        metaEl.textContent = [
          dish.category ? '分类：' + dish.category : '',
          dish.prepTimeMin ? '准备约 ' + dish.prepTimeMin + ' 分钟' : '',
          dish.caloriesKcal ? '约 ' + dish.caloriesKcal + ' kcal' : ''
        ].filter(Boolean).join(' · ');
        reasonEl.textContent = buildReason(dish);

        if (dish.photoUrl) {
          photoWrapEl.className = 'photo-wrap';
          var firstSrc = dish.thumbUrl || dish.photoUrl;
          photoWrapEl.innerHTML = '<img class="photo js-blur-up" loading="eager" decoding="async" src="' + firstSrc + '" alt="' + (dish.name || 'dish') + '" />';
          bindProgressiveImages(photoWrapEl);
        } else {
          photoWrapEl.className = 'photo-wrap empty';
          photoWrapEl.textContent = '这道菜暂时没有可用图片，不过你也可以换一道继续看看。';
        }
      } catch (err) {
        dishEl.textContent = '推荐失败，请再试一次';
        photoWrapEl.className = 'photo-wrap empty';
        photoWrapEl.textContent = '图片加载失败';
        metaEl.textContent = err.message || '网络错误';
        reasonEl.textContent = '这次没有成功拿到推荐结果，我们再试一下就好。';
      }
    }
  </script>
</body>
</html>`;
}


function dishManagePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>菜品管理</title>
  <style>
    :root { --bg:#fff8f3; --bg2:#fff1e7; --card:#fffdfb; --text:#46332b; --muted:#8b7870; --line:#f1ddd1; --accent:#ff8c6b; --accent2:#f7b267; --soft:#fff7f1; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',Roboto,sans-serif; color:var(--text); background:linear-gradient(160deg, var(--bg), var(--bg2)); padding:18px 14px calc(24px + env(safe-area-inset-bottom)); }
    .wrap { max-width:1180px; margin:0 auto; }
    .topbar { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px; }
    .nav-left { display:flex; gap:8px; flex-wrap:wrap; }
    .nav-link, .logout { text-decoration:none; color:#8a7770; border:1px solid var(--line); padding:10px 14px; border-radius:12px; background:rgba(255,255,255,.78); font-size:14px; }
    .hero { background:rgba(255,253,251,.94); border:1px solid var(--line); border-radius:24px; padding:20px 18px; box-shadow:0 16px 34px rgba(184,127,92,.12); margin-bottom:14px; }
    .hero h1 { margin:0; font-size:30px; }
    .hero p { margin:10px 0 0; color:var(--muted); line-height:1.7; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    .toolbar input, .toolbar select { padding:11px 12px; border:1px solid var(--line); border-radius:12px; background:#fff; font-size:14px; }
    .toolbar input { flex:1; min-width:220px; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr)); gap:10px; margin-top:14px; }
    .pager { display:flex; justify-content:center; margin-top:16px; }
    .stat { background:#fff9f4; border:1px solid var(--line); border-radius:16px; padding:12px; }
    .stat strong { display:block; font-size:22px; }
    .stat span { color:var(--muted); font-size:12px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:14px; }
    .dish-card { background:rgba(255,253,251,.96); border:1px solid var(--line); border-radius:22px; padding:16px; box-shadow:0 12px 24px rgba(184,127,92,.08); }
    .image-shell { position:relative; border-radius:16px; overflow:hidden; border:1px solid #f1e2d6; background:#fff7f1; min-height:180px; }
    .image-shell::before { content:''; position:absolute; inset:0; background:linear-gradient(110deg, rgba(255,244,236,.9) 8%, rgba(255,255,255,.95) 18%, rgba(255,244,236,.9) 33%); background-size:200% 100%; animation: shimmer 1.5s infinite; }
    .image-shell.loaded::before { display:none; }
    .dish-card img { width:100%; height:180px; object-fit:cover; background:#fff; filter:blur(16px); transform:scale(1.04); opacity:.74; transition:filter .55s ease, transform .55s ease, opacity .55s ease; position:relative; z-index:1; display:block; }
    .dish-card img.loaded { filter:blur(0); transform:scale(1); opacity:1; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .dish-card h2 { margin:12px 0 4px; font-size:20px; }
    .meta { color:var(--muted); font-size:13px; margin-bottom:10px; line-height:1.6; }
    .badge-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .badge { display:inline-block; padding:5px 9px; border-radius:999px; font-size:12px; background:#fff6ef; border:1px solid #f4dbc8; color:#96654d; }
    .badge.alt { background:#f8f8ff; border-color:#dddafc; color:#7067c7; }
    .badge.warn { background:#fff3ef; border-color:#ffd4c9; color:#c35a3f; }
    label { display:block; font-size:13px; color:#7e6a62; margin:10px 0 6px; }
    input[type=text], input[type=number], textarea, select { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:#fff; font-size:14px; }
    textarea { min-height:84px; resize:vertical; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .actions { display:flex; gap:10px; margin-top:12px; }
    .btn { flex:1; border:0; border-radius:12px; padding:12px; font-size:14px; font-weight:700; cursor:pointer; }
    .btn.primary { background:linear-gradient(90deg,var(--accent),var(--accent2)); color:#fff; }
    .btn.ghost { background:#fff; color:#7a6a6a; border:1px solid var(--line); }
    .status { margin-top:10px; font-size:13px; color:var(--muted); }
    @media (max-width:640px){ .row{grid-template-columns:1fr;} .hero h1{font-size:26px;} }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="nav-left">
        <a class="nav-link" href="/">← 返回首页</a>
        <a class="nav-link" href="/dinner">去看晚饭页</a>
      </div>
      <a class="logout" href="/logout">退出登录</a>
    </div>

    <section class="hero">
      <span class="badge">正式菜品 + YOLO候选统一管理 · V2</span>
      <h1>菜品管理后台</h1>
      <p>这里是这套系统的内容中台。你可以在这里统一查看正式菜品、YOLO 候选、自动分析结果和待确认数据，让后面的推荐、套餐、清单都建立在更干净的数据上。</p>
      <div id="stats" class="stats"></div>
      <div class="toolbar">
        <input id="searchInput" type="text" placeholder="搜索菜名 / 分类 / 材料 / 来源图片" />
        <select id="filterSelect">
          <option value="all">全部</option>
          <option value="dish">仅正式菜品</option>
          <option value="candidate">仅YOLO候选</option>
          <option value="pending">仅待确认</option>
          <option value="other">仅“其他”</option>
        </select>
      </div>
    </section>

    <section id="dishGrid" class="grid"></section>
    <div class="pager"><button id="loadMoreBtn" class="btn ghost" type="button" style="display:none;max-width:280px;">加载更多</button></div>
  </div>

  <script>
    let allDishes = [];
    let stats = {};
    let visibleCount = 20;
    const PAGE_SIZE = 20;

    function escapeHtml(str) {
      return String(str || '').replace(/[&<>\"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
    }

    function bindProgressiveImages(root) {
      (root || document).querySelectorAll('img.js-blur-up').forEach(function(img) {
        if (img.dataset.bound === '1') return;
        img.dataset.bound = '1';
        function done() {
          img.classList.add('loaded');
          var shell = img.closest('.image-shell, .photo-wrap');
          if (shell) shell.classList.add('loaded');
        }
        if (img.complete) done();
        else {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        }
      });
    }

    function renderStats() {
      const el = document.getElementById('stats');
      const cards = [
        ['总条目', stats.total || 0],
        ['正式菜品', stats.dish || 0],
        ['YOLO候选', stats.candidate || 0],
        ['待确认', stats.pending || 0],
        ['自动归为其他', stats.other || 0],
      ];
      el.innerHTML = cards.map(([k,v]) => '<div class="stat"><strong>' + v + '</strong><span>' + k + '</span></div>').join('');
    }

    function filterDish(d, keyword, filter) {
      if (filter === 'dish' && d.sourceType !== 'dish') return false;
      if (filter === 'candidate' && d.sourceType !== 'candidate') return false;
      if (filter === 'pending' && !d.needsConfirm) return false;
      if (filter === 'other' && d.category !== '其他') return false;
      if (!keyword) return true;
      const hay = [d.name, d.category, d.sourcePhoto, d.autoAnalysis, (d.ingredients || []).join(' '), d.nutritionNote, (d.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(keyword);
    }

    function renderDishes(resetVisible) {
      if (resetVisible) visibleCount = PAGE_SIZE;
      const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
      const filter = document.getElementById('filterSelect').value;
      const list = allDishes.filter(d => filterDish(d, keyword, filter));
      const grid = document.getElementById('dishGrid');
      const loadMoreBtn = document.getElementById('loadMoreBtn');
      if (!list.length) {
        grid.innerHTML = '<div class="dish-card"><h2>没有匹配结果</h2><div class="meta">换个关键词试试～</div></div>';
        loadMoreBtn.style.display = 'none';
        return;
      }
      const shown = list.slice(0, visibleCount);
      grid.innerHTML = shown.map(function(d) {
        const photoPath = (d.photo || '').startsWith('/') ? (d.photo || '') : '/' + (d.photo || '');
        const thumbPath = (d.thumbPhoto || d.photo || '').startsWith('/') ? (d.thumbPhoto || d.photo || '') : '/' + (d.thumbPhoto || d.photo || '');
        return '' +
          '<form class="dish-card" data-id="' + escapeHtml(d.id) + '" data-source="' + escapeHtml(d.sourceType || '') + '">' +
            '<div class="image-shell">' +
              '<img class="js-blur-up" loading="lazy" decoding="async" src="/dinner-assets' + escapeHtml(thumbPath) + '" alt="' + escapeHtml(d.name) + '" />' +
            '</div>' +
            '<h2>' + escapeHtml(d.name) + '</h2>' +
            '<div class="badge-row">' +
              '<span class="badge alt">' + escapeHtml(d.sourceLabel || '') + '</span>' +
              '<span class="badge">' + (d.needsConfirm ? '待确认' : '已确认') + '</span>' +
              (d.category === '其他' ? '<span class="badge warn">其他</span>' : '') +
            '</div>' +
            '<div class="meta">' + escapeHtml(d.id) + (d.sourcePhoto ? ' · 来源 ' + escapeHtml(d.sourcePhoto) : '') + '<br>' + escapeHtml(d.autoAnalysis || '') + '</div>' +
            '<label>菜名</label>' +
            '<input type="text" name="name" value="' + escapeHtml(d.name) + '" />' +
            '<div class="row">' +
              '<div>' +
                '<label>分类</label>' +
                '<input type="text" name="category" value="' + escapeHtml(d.category || '') + '" />' +
              '</div>' +
              '<div>' +
                '<label>是否待确认</label>' +
                '<select name="needsConfirm">' +
                  '<option value="false" ' + (d.needsConfirm ? '' : 'selected') + '>已确认</option>' +
                  '<option value="true" ' + (d.needsConfirm ? 'selected' : '') + '>待确认</option>' +
                '</select>' +
              '</div>' +
            '</div>' +
            '<div class="row">' +
              '<div>' +
                '<label>制作时间（分钟）</label>' +
                '<input type="number" name="prepTimeMin" value="' + Number(d.prepTimeMin || 0) + '" />' +
              '</div>' +
              '<div>' +
                '<label>热量（kcal）</label>' +
                '<input type="number" name="caloriesKcal" value="' + Number(d.caloriesKcal || 0) + '" />' +
              '</div>' +
            '</div>' +
            '<label>材料（每行一个）</label>' +
            '<textarea name="ingredients">' + escapeHtml((d.ingredients || []).join('\\n')) + '</textarea>' +
            '<label>营养说明</label>' +
            '<textarea name="nutritionNote">' + escapeHtml(d.nutritionNote || '') + '</textarea>' +
            '<label>标签（逗号分隔）</label>' +
            '<input type="text" name="tags" value="' + escapeHtml((d.tags || []).join(', ')) + '" />' +
            '<label>图片路径</label>' +
            '<input type="text" name="photo" value="' + escapeHtml(d.photo || '') + '" />' +
            '<div class="actions">' +
              '<button type="button" class="btn primary" onclick="saveDish(\\\'' + escapeHtml(d.id) + '\\\', this)">保存修改</button>' +
              '<button type="button" class="btn ghost" onclick="window.open(\\'/dinner-assets' + escapeHtml(photoPath) + '\\', \\'_blank\\')">查看原图</button>' +
            '</div>' +
            '<div class="status" id="status-' + escapeHtml(d.id) + '">未修改</div>' +
          '</form>';
      }).join('');
      bindProgressiveImages(grid);
      if (visibleCount < list.length) {
        loadMoreBtn.style.display = 'inline-flex';
        loadMoreBtn.textContent = '加载更多（已显示 ' + shown.length + ' / ' + list.length + '）';
      } else {
        loadMoreBtn.style.display = 'none';
      }
    }

    async function loadDishes() {
      const grid = document.getElementById('dishGrid');
      try {
        grid.innerHTML = '<div class="dish-card"><h2>正在加载菜品…</h2><div class="meta">稍等一下，我正在读取后台数据。</div></div>';
        const res = await fetch('/api/dishes', { cache: 'no-store', credentials: 'same-origin' });
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          throw new Error('接口没有返回 JSON，可能是页面缓存或登录态问题');
        }
        if (!res.ok || !data.success) throw new Error(data.error || ('接口异常：HTTP ' + res.status));
        allDishes = data.dishes || [];
        stats = data.stats || {};
        renderStats();
        renderDishes(true);
      } catch (err) {
        grid.innerHTML = '<div class="dish-card"><h2>菜品加载失败</h2><div class="meta">' + escapeHtml(err.message || '未知错误') + '</div></div>';
      }
    }

    async function saveDish(id, btn) {
      const card = btn.closest('form');
      const status = document.getElementById('status-' + id);
      const payload = {
        sourceType: card.getAttribute('data-source') || '',
        name: card.querySelector('[name=name]').value.trim(),
        category: card.querySelector('[name=category]').value.trim(),
        needsConfirm: card.querySelector('[name=needsConfirm]').value === 'true',
        prepTimeMin: Number(card.querySelector('[name=prepTimeMin]').value || 0),
        caloriesKcal: Number(card.querySelector('[name=caloriesKcal]').value || 0),
        ingredients: card.querySelector('[name=ingredients]').value,
        nutritionNote: card.querySelector('[name=nutritionNote]').value.trim(),
        tags: card.querySelector('[name=tags]').value,
        photo: card.querySelector('[name=photo]').value.trim()
      };
      btn.disabled = true;
      status.textContent = '保存中...';
      try {
        const res = await fetch('/api/dishes/' + encodeURIComponent(id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '保存失败');
        status.textContent = '已保存';
        await loadDishes();
      } catch (err) {
        status.textContent = '保存失败：' + (err.message || '未知错误');
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('searchInput').addEventListener('input', function(){ renderDishes(true); });
    document.getElementById('filterSelect').addEventListener('change', function(){ renderDishes(true); });
    document.getElementById('loadMoreBtn').addEventListener('click', function(){ visibleCount += PAGE_SIZE; renderDishes(false); });
    loadDishes();
  </script>
</body>
</html>`;
}

function placeholderPage({ icon, title, desc, note }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${title}</title>
  <style>
    :root { --bg:#fff8f3; --bg2:#fff1e7; --card:#fffdfb; --text:#46332b; --muted:#8b7870; --line:#f1ddd1; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',Roboto,sans-serif; color:var(--text); background:linear-gradient(160deg, var(--bg), var(--bg2)); padding:18px 14px; }
    .wrap { max-width:720px; margin:0 auto; }
    .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
    .nav, .logout { text-decoration:none; color:#8a7770; border:1px solid var(--line); padding:10px 14px; border-radius:12px; background:rgba(255,255,255,.78); font-size:14px; }
    .card { background:rgba(255,253,251,.94); border:1px solid var(--line); border-radius:26px; padding:26px 20px; box-shadow:0 16px 34px rgba(184,127,92,.12); }
    .icon { font-size:34px; margin-bottom:10px; }
    h1 { margin:0; font-size:30px; }
    p { margin:12px 0 0; color:var(--muted); line-height:1.75; font-size:15px; }
    .note { margin-top:16px; padding:14px; border-radius:16px; background:#fff7f1; border:1px dashed #f0dbc9; color:#78655d; font-size:14px; line-height:1.7; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <a class="nav" href="/">← 返回首页</a>
      <a class="logout" href="/logout">退出登录</a>
    </div>
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${desc}</p>
      <div class="note">${note}</div>
    </div>
  </div>
</body>
</html>`;
}

function resumePage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>翟博 · 技术简历</title>
  <style>
    :root {
      --bg:#050816;
      --panel:#0b1328;
      --panel-2:#111c36;
      --line:#203053;
      --text:#e7eeff;
      --muted:#9cb0d0;
      --accent:#4f9cff;
      --accent-2:#00d4ff;
      --good:#37d39a;
    }
    * { box-sizing:border-box; }
    html, body { margin:0; padding:0; }
    body {
      font-family:'Inter','PingFang SC','Segoe UI',system-ui,-apple-system,sans-serif;
      color:var(--text);
      background:
        radial-gradient(circle at 85% -10%, rgba(79,156,255,.18), transparent 32%),
        radial-gradient(circle at 15% 20%, rgba(0,212,255,.13), transparent 30%),
        var(--bg);
      line-height:1.55;
    }
    .wrap { width:min(1120px, 94vw); margin:26px auto 42px; }
    .top {
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:12px;
      margin-bottom:20px;
    }
    .nav a {
      text-decoration:none;
      color:#c6d6f3;
      border:1px solid var(--line);
      padding:9px 14px;
      border-radius:10px;
      margin-left:8px;
      transition:.2s;
    }
    .nav a:hover { border-color:var(--accent); color:#fff; }
    .hero {
      border:1px solid var(--line);
      border-radius:20px;
      padding:28px;
      background:linear-gradient(155deg, rgba(9,16,34,.85), rgba(9,16,34,.65));
      box-shadow:0 24px 80px rgba(0,0,0,.35);
      margin-bottom:18px;
    }
    .badge {
      display:inline-block;
      font-size:12px;
      letter-spacing:.06em;
      text-transform:uppercase;
      border:1px solid rgba(79,156,255,.45);
      border-radius:999px;
      padding:6px 12px;
      color:#bdd4ff;
      margin-bottom:12px;
    }
    h1 { margin:0; font-size:38px; }
    .subtitle { margin:10px 0 0; color:var(--muted); font-size:16px; max-width:840px; }
    .grid {
      display:grid;
      grid-template-columns: 1.35fr 1fr;
      gap:16px;
    }
    .card {
      border:1px solid var(--line);
      border-radius:16px;
      background:linear-gradient(170deg, rgba(17,28,54,.75), rgba(11,19,40,.75));
      padding:20px;
    }
    .card h2 {
      margin:0 0 12px;
      font-size:18px;
      display:flex;
      align-items:center;
      gap:8px;
    }
    .dot {
      width:8px;
      height:8px;
      border-radius:999px;
      background:linear-gradient(180deg,var(--accent),var(--accent-2));
      box-shadow:0 0 12px rgba(79,156,255,.9);
    }
    .timeline { display:flex; flex-direction:column; gap:14px; }
    .item { border-left:2px solid #213355; padding-left:12px; }
    .item .title { font-weight:700; }
    .item .meta { color:var(--muted); font-size:13px; margin:2px 0 6px; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; }
    .chip {
      padding:6px 10px;
      border:1px solid #2a3e67;
      border-radius:999px;
      background:rgba(18,30,58,.65);
      color:#d7e4ff;
      font-size:13px;
    }
    .kpi { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px; }
    .kpi .box {
      border:1px solid #273a60;
      border-radius:12px;
      padding:10px 12px;
      background:rgba(13,22,44,.75);
    }
    .kpi .box b { font-size:20px; color:#fff; }
    .kpi .box span { display:block; font-size:12px; color:var(--muted); }
    .footer-note {
      margin-top:14px;
      color:#87f0c8;
      font-size:13px;
      border-top:1px dashed #25486f;
      padding-top:12px;
    }
    @media (max-width: 900px) {
      .grid { grid-template-columns:1fr; }
      h1 { font-size:32px; }
      .kpi { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div style="font-weight:700;color:#d9e7ff;">Resume · 技术风简历</div>
      <nav class="nav">
        <a href="/">返回主页</a>
        <a href="/logout">退出登录</a>
      </nav>
    </header>

    <section class="hero">
      <span class="badge">AI × Control × Automotive</span>
      <h1>翟博 · 智能算法负责人</h1>
      <p class="subtitle">电气工程博士（控制科学方向），长期深耕 AI 与新能源汽车智能化落地。擅长将控制理论、工程系统与 AI 方法融合，推动从算法研发到业务价值闭环。</p>
      <div class="kpi">
        <div class="box"><b>2+ 年</b><span>AI 转型深耕</span></div>
        <div class="box"><b>Leader</b><span>团队与项目推进</span></div>
        <div class="box"><b>北京</b><span>新能源汽车行业实践</span></div>
      </div>
    </section>

    <main class="grid">
      <section class="card">
        <h2><span class="dot"></span>工作经历</h2>
        <div class="timeline">
          <div class="item">
            <div class="title">理想汽车 · 热管理方向 AI 相关工作</div>
            <div class="meta">北京 · 当前</div>
            <div>负责 AI 在业务场景中的落地推进，兼顾算法可行性、工程实现与跨团队协作，持续迭代交付效率与质量。</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2><span class="dot"></span>教育背景</h2>
        <div class="timeline">
          <div class="item">
            <div class="title">电气工程博士</div>
            <div class="meta">控制科学方向</div>
            <div>具备扎实的系统建模、控制理论与工程问题分解能力，为 AI 在物理系统中的落地提供方法论支撑。</div>
          </div>
        </div>
      </section>

      <section class="card">
        <h2><span class="dot"></span>核心能力</h2>
        <div class="chips">
          <span class="chip">AI 算法落地</span>
          <span class="chip">智能控制系统</span>
          <span class="chip">跨学科融合（控制 + AI）</span>
          <span class="chip">技术团队管理</span>
          <span class="chip">复杂问题拆解</span>
          <span class="chip">业务价值闭环</span>
          <span class="chip">面向产品的工程化思维</span>
        </div>
      </section>

      <section class="card">
        <h2><span class="dot"></span>职业方向</h2>
        <div class="timeline">
          <div class="item">
            <div class="title">下一阶段目标</div>
            <div>聚焦更大平台的 AI 核心岗位，继续强化大模型与感知相关能力，提升技术影响力与组织协同效率。</div>
          </div>
          <div class="item">
            <div class="title">长期愿景</div>
            <div>结合 AI 与具身智能发展趋势，发挥控制科学与工程背景优势，持续构建可复制的技术与业务成果。</div>
          </div>
        </div>
        <div class="footer-note">提示：如需投递版本，可继续补充“项目成果量化数据、论文专利、联系方式与作品链接”。</div>
      </section>
    </main>
  </div>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

function uploadPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>文件传输</title>
  <style>
    :root {
      --bg-1:#070b14; --bg-2:#0f172a; --card:#0f1a2f;
      --line:#1f2a44; --text:#e6edf7; --muted:#98a8c5;
      --accent:#3b82f6; --accent-2:#22d3ee; --good:#37d39a; --warn:#f59e0b; --bad:#ef4444;
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      min-height:100vh; color:var(--text);
      font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
      background: radial-gradient(circle at 20% 20%, #172554 0%, var(--bg-1) 42%), linear-gradient(135deg, var(--bg-1), var(--bg-2));
    }
    .wrap { width:min(800px, 94vw); margin:30px auto; }
    .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .top h1 { font-size:24px; }
    .nav a {
      text-decoration:none; color:#c6d6f3; border:1px solid var(--line);
      padding:9px 14px; border-radius:10px; margin-left:8px; transition:.2s;
    }
    .nav a:hover { border-color:var(--accent); color:#fff; }
    .upload-zone {
      border:2px dashed var(--line); border-radius:16px;
      padding:48px 24px; text-align:center; cursor:pointer;
      background:rgba(15,26,47,.5); transition:all .3s;
    }
    .upload-zone.dragover { border-color:var(--accent); background:rgba(59,130,246,.08); }
    .upload-zone .icon { font-size:48px; margin-bottom:12px; }
    .upload-zone p { color:var(--muted); font-size:15px; }
    .upload-zone .hint { font-size:13px; color:#6b7fa0; margin-top:8px; }
    #fileInput { display:none; }
    .progress-wrap {
      margin-top:16px; display:none;
      border:1px solid var(--line); border-radius:12px;
      padding:16px; background:rgba(15,26,47,.7);
    }
    .progress-wrap.show { display:block; }
    .file-info { display:flex; justify-content:space-between; margin-bottom:10px; font-size:14px; }
    .bar-bg { height:8px; background:#1a2744; border-radius:99px; overflow:hidden; }
    .bar-fill { height:100%; width:0%; background:linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius:99px; transition:width .3s; }
    .status { margin-top:10px; font-size:14px; color:var(--muted); }
    .status.ok { color:var(--good); }
    .status.err { color:var(--bad); }
    .file-list {
      margin-top:20px; border:1px solid var(--line); border-radius:16px;
      background:rgba(15,26,47,.5); overflow:hidden;
    }
    .file-list h2 { padding:14px 18px; font-size:16px; border-bottom:1px solid var(--line); }
    .file-item {
      display:flex; justify-content:space-between; align-items:center;
      padding:12px 18px; border-bottom:1px solid rgba(31,42,68,.5);
    }
    .file-item:last-child { border-bottom:none; }
    .file-item .name { font-size:14px; word-break:break-all; }
    .file-item .meta { font-size:12px; color:var(--muted); white-space:nowrap; margin-left:12px; }
    .empty { padding:20px; text-align:center; color:#6b7fa0; font-size:14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <h1>📁 文件传输</h1>
      <nav class="nav">
        <a href="/">主页</a>
        <a href="/logout">退出</a>
      </nav>
    </header>

    <div class="upload-zone" id="dropZone">
      <div class="icon">📤</div>
      <p>点击选择文件 或 拖拽文件到这里</p>
      <div class="hint">支持最大 300MB，不限文件类型</div>
    </div>
    <input type="file" id="fileInput" />

    <div class="progress-wrap" id="progressWrap">
      <div class="file-info">
        <span id="fileName">-</span>
        <span id="fileSize">-</span>
      </div>
      <div class="bar-bg"><div class="bar-fill" id="barFill"></div></div>
      <div class="status" id="statusText">准备上传...</div>
    </div>

    <div class="file-list" id="fileList">
      <h2>已上传文件</h2>
      <div id="fileListBody"><div class="empty">暂无文件</div></div>
    </div>
  </div>

  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const progressWrap = document.getElementById('progressWrap');
    const barFill = document.getElementById('barFill');
    const statusText = document.getElementById('statusText');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) uploadFile(fileInput.files[0]);
    });

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
      return (bytes/1024/1024).toFixed(1) + ' MB';
    }

    function uploadFile(file) {
      document.getElementById('fileName').textContent = file.name;
      document.getElementById('fileSize').textContent = formatSize(file.size);
      progressWrap.classList.add('show');
      barFill.style.width = '0%';
      statusText.textContent = '上传中...';
      statusText.className = 'status';

      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round(e.loaded / e.total * 100);
          barFill.style.width = pct + '%';
          statusText.textContent = '上传中... ' + pct + '% (' + formatSize(e.loaded) + ' / ' + formatSize(e.total) + ')';
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          const res = JSON.parse(xhr.responseText);
          if (res.success) {
            statusText.textContent = '✅ 上传成功！文件: ' + res.filename + ' (' + formatSize(res.size) + ')';
            statusText.className = 'status ok';
            loadFileList();
          } else {
            statusText.textContent = '❌ 上传失败: ' + (res.error || '未知错误');
            statusText.className = 'status err';
          }
        } else {
          statusText.textContent = '❌ 上传失败 (HTTP ' + xhr.status + ')';
          statusText.className = 'status err';
        }
      };

      xhr.onerror = () => {
        statusText.textContent = '❌ 网络错误，请检查连接后重试';
        statusText.className = 'status err';
      };

      xhr.ontimeout = () => {
        statusText.textContent = '❌ 上传超时，请重试';
        statusText.className = 'status err';
      };

      xhr.timeout = 600000; // 10分钟超时
      xhr.send(formData);
    }

    function loadFileList() {
      fetch('/api/files')
        .then(r => r.json())
        .then(data => {
          const body = document.getElementById('fileListBody');
          if (!data.success || !data.files.length) {
            body.innerHTML = '<div class="empty">暂无文件</div>';
            return;
          }
          body.innerHTML = data.files.map(f => {
            const date = new Date(f.uploadTime).toLocaleString('zh-CN');
            return '<div class="file-item">' +
              '<span class="name">' + f.filename + '</span>' +
              '<span class="meta">' + formatSize(f.size) + ' · ' + date + '</span>' +
            '</div>';
          }).join('');
        });
    }

    loadFileList();
  </script>
</body>
</html>`;
}

app.get('/login', (req, res) => {
  const hasError = req.query.error === '1';
  res.status(200).send(loginPage(hasError));
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (String(password) === String(LOGIN_PASSWORD)) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/', requireAuth, (req, res) => {
  res.status(200).send(homePage());
});

app.get('/dinner', requireAuth, (req, res) => {
  res.status(200).send(dinnerPage());
});

app.get('/manage-dishes', requireAuth, (req, res) => {
  res.status(200).send(dishManagePage());
});

app.get('/surprise', requireAuth, (req, res) => {
  res.status(200).send(placeholderPage({
    icon: '🎁',
    title: '今日惊喜',
    desc: '这个页面会放当天的小惊喜、小话语，或者一个让人心情变好的小彩蛋。第一版先把入口留好，后面我们可以把它做成每天都会更新的小角落。',
    note: '后续可扩展：每日一句、随机惊喜、纪念日提醒、节日彩蛋。'
  }));
});

app.get('/gallery', requireAuth, (req, res) => {
  res.status(200).send(placeholderPage({
    icon: '📷',
    title: '回忆相册',
    desc: '这里以后会慢慢放进你们一起的照片、值得记住的瞬间、旅行片段和温柔的小回忆。',
    note: '后续可扩展：时间轴、相册分组、纪念日回顾、旅行地图。'
  }));
});

app.get('/letter', requireAuth, (req, res) => {
  res.status(200).send(placeholderPage({
    icon: '💌',
    title: '想对你说',
    desc: '这里适合放一些想认真留给她看的话，比如今天想说的、节日想说的、想安慰她时想说的。',
    note: '后续可扩展：留言卡片、日期归档、置顶留言、节日专属内容。'
  }));
});

app.get('/api/dishes', requireAuth, (req, res) => {
  const dishes = loadManagedDishes();
  const stats = {
    total: dishes.length,
    dish: dishes.filter(x => x.sourceType === 'dish').length,
    candidate: dishes.filter(x => x.sourceType === 'candidate').length,
    pending: dishes.filter(x => x.needsConfirm).length,
    other: dishes.filter(x => x.category === '其他').length,
  };
  return res.json({ success: true, dishes, stats });
});

app.put('/api/dishes/:id', requireAuth, (req, res) => {
  const id = String(req.params.id);
  const sourceType = String(req.body.sourceType || '').trim();
  const isCandidate = sourceType === 'candidate' || id.startsWith('yolo-candidate-');
  const list = isCandidate ? loadDinnerCandidates() : loadDinnerDishes();
  const idx = list.findIndex(x => String(x.id) === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: '菜品不存在' });
  }

  const current = list[idx];
  const next = {
    ...current,
    name: String(req.body.name || '').trim() || current.name,
    category: String(req.body.category || '').trim() || current.category,
    prepTimeMin: Number(req.body.prepTimeMin || current.prepTimeMin || 0),
    caloriesKcal: Number(req.body.caloriesKcal || current.caloriesKcal || 0),
    ingredients: parseListField(req.body.ingredients),
    nutritionNote: String(req.body.nutritionNote || '').trim(),
    tags: parseListField(req.body.tags),
    photo: String(req.body.photo || '').trim() || current.photo,
    needsConfirm: Boolean(req.body.needsConfirm),
  };

  list[idx] = next;
  if (isCandidate) {
    saveDinnerCandidates(list);
    return res.json({ success: true, dish: analyzeCandidateRecord(next) });
  }

  saveDinnerDishes(list);
  return res.json({ success: true, dish: {
    ...next,
    sourceType: 'dish',
    sourceLabel: '正式菜品',
    thumbPhoto: mapDishThumbUrl(next.photo).replace('/dinner-assets', ''),
  } });
});

app.get('/api/dinner/random', requireAuth, (req, res) => {
  const dishes = loadManagedDishes().filter(d => !d.excludedFromFinal && d.category !== '其他');
  if (!dishes.length) {
    return res.status(500).json({ success: false, error: '最终菜谱数据为空，请检查 dishes/candidates 数据' });
  }

  const withPhoto = dishes.filter(dinnerDishHasPhotoFile);
  const pool = withPhoto.length ? withPhoto : dishes;
  const picked = pool[Math.floor(Math.random() * pool.length)];

  return res.json({
    success: true,
    dish: {
      id: picked.id,
      name: picked.name,
      category: picked.category,
      prepTimeMin: picked.prepTimeMin,
      caloriesKcal: picked.caloriesKcal,
      photoUrl: mapDishPhotoUrl(picked.photo),
      thumbUrl: mapDishThumbUrl(picked.photo),
    }
  });
});

app.get('/resume', requireAuth, (req, res) => {
  res.status(200).send(resumePage());
});

// 文件上传页面
app.get('/upload', requireAuth, (req, res) => {
  res.status(200).send(uploadPage());
});

// 文件上传接口
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '没有收到文件' });
  }
  
  res.json({
    success: true,
    filename: req.file.filename,
    size: req.file.size,
    path: req.file.path
  });
});

// 文件列表接口
app.get('/api/files', requireAuth, (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ success: false, error: '读取文件列表失败' });
    }
    
    const fileList = files.map(filename => {
      const filePath = path.join(UPLOAD_DIR, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        uploadTime: stats.mtime
      };
    });
    
    res.json({ success: true, files: fileList });
  });
});

// 文件下载接口
app.get('/api/download/:filename', requireAuth, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOAD_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }
  
  res.download(filePath, filename);
});

function createRedirectApp() {
  const redirectApp = express();
  redirectApp.use((req, res) => {
    const host = req.headers.host || 'juchen.me';
    const targetHost = host.replace(/:\d+$/, '');
    res.redirect(301, `https://${targetHost}${req.originalUrl || '/'}`);
  });
  return redirectApp;
}

function startServers() {
  const hasTlsFiles = fs.existsSync(TLS_CERT_PATH) && fs.existsSync(TLS_KEY_PATH);

  if (FORCE_HTTPS && hasTlsFiles) {
    const httpsOptions = {
      cert: fs.readFileSync(TLS_CERT_PATH),
      key: fs.readFileSync(TLS_KEY_PATH)
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`HTTPS server running at https://0.0.0.0:${HTTPS_PORT}`);
    });

    http.createServer(createRedirectApp()).listen(PORT, '0.0.0.0', () => {
      console.log(`HTTP redirect server running at http://0.0.0.0:${PORT}`);
    });

    return;
  }

  if (FORCE_HTTPS && !hasTlsFiles) {
    console.warn(`[WARN] FORCE_HTTPS=true but TLS files missing. Falling back to HTTP only. cert=${TLS_CERT_PATH} key=${TLS_KEY_PATH}`);
  }

  http.createServer(app).listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server running at http://0.0.0.0:${PORT}`);
  });
}

startServers();
