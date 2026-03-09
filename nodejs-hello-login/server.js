const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD;
if (!LOGIN_PASSWORD || !/^\d{6}$/.test(LOGIN_PASSWORD)) {
  console.error('Missing or invalid LOGIN_PASSWORD. Please set a 6-digit number in .env');
  process.exit(1);
}

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.PORT || 3000);

app.use(express.urlencoded({ extended: false }));
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>登录</title>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; background:#f5f7fb; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; }
    .card { background:#fff; padding:24px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.08); width:320px; }
    h1 { margin:0 0 16px; font-size:20px; }
    input { width:100%; padding:10px 12px; border:1px solid #d9dde5; border-radius:8px; font-size:16px; box-sizing:border-box; }
    button { margin-top:12px; width:100%; padding:10px 12px; border:0; border-radius:8px; background:#1677ff; color:#fff; font-size:16px; cursor:pointer; }
    .err { color:#d93025; font-size:14px; margin-bottom:8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>请输入密码登录</h1>
    ${hasError ? '<div class="err">密码错误，请重试</div>' : ''}
    <form method="post" action="/login">
      <input type="password" name="password" placeholder="6位数字密码" maxlength="6" inputmode="numeric" required />
      <button type="submit">登录</button>
    </form>
  </div>
</body>
</html>`;
}

function helloPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hello</title>
  <style>
    :root {
      --bg-1:#070b14;
      --bg-2:#0f172a;
      --card:#0f1a2f;
      --line:#1f2a44;
      --text:#e6edf7;
      --muted:#98a8c5;
      --accent:#3b82f6;
      --accent-2:#22d3ee;
    }
    * { box-sizing:border-box; }
    body {
      margin:0;
      min-height:100vh;
      display:flex;
      justify-content:center;
      align-items:center;
      color:var(--text);
      font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
      background: radial-gradient(circle at 20% 20%, #172554 0%, var(--bg-1) 42%), linear-gradient(135deg, var(--bg-1), var(--bg-2));
      overflow:hidden;
    }
    .panel {
      width:min(760px, 92vw);
      border:1px solid rgba(147,197,253,.25);
      border-radius:20px;
      padding:38px;
      background:linear-gradient(160deg, rgba(11,18,33,.85), rgba(8,14,25,.92));
      box-shadow:0 30px 80px rgba(2,8,23,.55), inset 0 0 0 1px rgba(34,211,238,.1);
      backdrop-filter: blur(8px);
    }
    .tag {
      display:inline-block;
      padding:6px 12px;
      border:1px solid rgba(59,130,246,.45);
      border-radius:999px;
      color:#c7dbff;
      font-size:12px;
      letter-spacing:.06em;
      text-transform:uppercase;
      margin-bottom:14px;
    }
    h1 { margin:0; font-size:56px; letter-spacing:.02em; }
    p { margin:14px 0 0; color:var(--muted); font-size:18px; }
    .actions { margin-top:30px; display:flex; gap:12px; flex-wrap:wrap; }
    .btn {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:12px 18px;
      border-radius:12px;
      text-decoration:none;
      font-weight:600;
      border:1px solid var(--line);
      transition:all .2s ease;
    }
    .btn.primary { background:linear-gradient(90deg, var(--accent), var(--accent-2)); color:#06101f; border:none; }
    .btn.ghost { color:#dbe8ff; background:rgba(15,26,47,.7); }
    .btn:hover { transform:translateY(-1px); box-shadow:0 8px 20px rgba(59,130,246,.25); }
  </style>
</head>
<body>
  <section class="panel">
    <span class="tag">Node.js · Secure Access</span>
    <h1>hello world</h1>
    <p>欢迎来到你的个人主页。已接入密码登录与个人简历页。</p>
    <div class="actions">
      <a class="btn primary" href="/resume">查看个人简历</a>
      <a class="btn ghost" href="/logout">退出登录</a>
    </div>
  </section>
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
  res.status(200).send(helloPage());
});

app.get('/resume', requireAuth, (req, res) => {
  res.status(200).send(resumePage());
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
