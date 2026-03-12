let dishes = [];
let splitCandidates = [];

const els = {
  dishList: document.getElementById('dishList'),
  recommendation: document.getElementById('recommendation'),
  planPreview: document.getElementById('planPreview'),
  dataSummary: document.getElementById('dataSummary'),
  photoImportStatus: document.getElementById('photoImportStatus'),
  jpgGallery: document.getElementById('jpgGallery'),
  timeLimit: document.getElementById('timeLimit'),
  goal: document.getElementById('goal'),
  category: document.getElementById('category'),
  ingredientsInput: document.getElementById('ingredientsInput'),
  quickOnly: document.getElementById('quickOnly'),
  lowCal: document.getElementById('lowCal'),
  btnRecommend: document.getElementById('btnRecommend'),
  btnPlan: document.getElementById('btnPlan'),
  btnRandom: document.getElementById('btnRandom'),
  btnReset: document.getElementById('btnReset')
};

init();

async function init() {
  const res = await fetch('/data/dishes.json');
  dishes = await res.json();

  try {
    const r2 = await fetch('/data/dish-split-candidates.json');
    if (r2.ok) splitCandidates = await r2.json();
  } catch {
    splitCandidates = [];
  }

  renderDishList(dishes);
  renderDataSummary();
  renderPlanPreview(applyFilters(dishes));
  loadPhotoImportStatus();
  loadJpgGallery();

  els.btnRecommend.addEventListener('click', () => {
    const filtered = applyFilters(dishes);
    renderDishList(filtered);
    renderRecommendation(filtered);
    renderPlanPreview(filtered);
  });

  els.btnPlan.addEventListener('click', () => {
    const filtered = applyFilters(dishes);
    renderPlanPreview(filtered);
  });

  els.btnRandom.addEventListener('click', () => {
    const filtered = applyFilters(dishes);
    renderDishList(filtered);
    renderRandom(filtered);
  });

  els.btnReset.addEventListener('click', () => {
    els.timeLimit.value = '30';
    els.goal.value = '均衡';
    els.category.value = '全部';
    els.ingredientsInput.value = '';
    els.quickOnly.checked = false;
    els.lowCal.checked = false;
    renderDishList(dishes);
    renderDataSummary();
    renderPlanPreview(applyFilters(dishes));
    els.recommendation.innerHTML = '点击“给我推荐晚饭”开始';
    els.recommendation.classList.add('empty');
  });
}

function renderDataSummary() {
  const needsConfirmCount = dishes.filter((d) => d.needsConfirm).length;
  const jpgCount = dishes.filter((d) => /\.jpe?g$/i.test(d.photo || '')).length;

  els.dataSummary.innerHTML = `
    <div class="summary-item"><div class="k">菜品总数</div><div class="v">${dishes.length}</div></div>
    <div class="summary-item"><div class="k">待确认菜名</div><div class="v">${needsConfirmCount}</div></div>
    <div class="summary-item"><div class="k">菜品 JPG 覆盖</div><div class="v">${jpgCount}</div></div>
    <div class="summary-item"><div class="k">一图多菜候选</div><div class="v">${splitCandidates.length}</div></div>
  `;
}

async function loadPhotoImportStatus() {
  try {
    const res = await fetch('/api/photo-import-status');
    const data = await res.json();
    if (!data.ok || !data.exists) {
      els.photoImportStatus.classList.remove('empty');
      els.photoImportStatus.innerHTML = '尚未检测到素材目录 /uploads/food-photos-20260311';
      return;
    }

    const mb = (data.totalBytes / 1024 / 1024).toFixed(1);
    const extSummary = Object.entries(data.byExt)
      .map(([k, v]) => `${k}: ${v}`)
      .join('，');

    els.photoImportStatus.classList.remove('empty');
    els.photoImportStatus.innerHTML = `
      <div><strong>已导入素材：</strong>${data.fileCount} 个文件（约 ${mb} MB）</div>
      <div class="small">目录：${data.folder}</div>
      <div class="small">类型分布：${extSummary || '无'}</div>
      <div class="small">样例：${(data.sample || []).slice(0, 5).map((f) => f.name).join('、')}</div>
    `;
  } catch (e) {
    els.photoImportStatus.classList.remove('empty');
    els.photoImportStatus.innerHTML = `素材状态读取失败：${e.message || 'unknown error'}`;
  }
}

async function loadJpgGallery() {
  if (!els.jpgGallery) return;
  try {
    const res = await fetch('/api/jpg-gallery');
    const data = await res.json();
    if (!data.ok || !data.fileCount) {
      els.jpgGallery.innerHTML = '<div class="small">暂时没有可展示的 JPG 图片。</div>';
      return;
    }

    els.jpgGallery.innerHTML = (data.files || [])
      .map((f) => `
        <article class="jpg-item">
          <img src="${f.photo}" alt="${f.name}" loading="lazy" />
          <div class="info">
            <div>${f.name}</div>
            <div>${(f.size / 1024).toFixed(0)} KB</div>
            ${f.mappedToDish ? '<span class="badge">已映射到菜谱</span>' : '<span class="badge">仅素材图</span>'}
          </div>
        </article>
      `)
      .join('');
  } catch (e) {
    els.jpgGallery.innerHTML = `<div class="small">JPG 画廊加载失败：${e.message || 'unknown error'}</div>`;
  }
}

function applyFilters(list) {
  const timeLimit = Number(els.timeLimit.value);
  const category = els.category.value;
  const quickOnly = els.quickOnly.checked;

  return list.filter((d) => {
    if (category !== '全部' && d.category !== category) return false;
    if (d.prepTimeMin > timeLimit) return false;
    if (quickOnly && d.prepTimeMin > 20) return false;
    return true;
  });
}

function scoreDishDetail(dish, profile) {
  const goal = profile.goal;
  const lowCal = profile.lowCal;
  const timeLimit = Number(profile.timeLimit);
  const pantry = profile.pantry || [];

  let score = 50;
  const reasons = [];

  if (dish.prepTimeMin <= timeLimit) {
    score += 16;
    reasons.push(`时间匹配（${dish.prepTimeMin}分钟 ≤ ${timeLimit}分钟）`);
  } else {
    score -= 24;
  }

  if (goal === '减脂') {
    if (dish.caloriesKcal <= 320) {
      score += 25;
      reasons.push('更符合减脂热量区间');
    } else score -= 15;
  } else if (goal === '补能量') {
    if (dish.caloriesKcal >= 380) {
      score += 20;
      reasons.push('更适合补能量');
    } else score -= 8;
  } else {
    if ((dish.tags || []).includes('高蛋白')) {
      score += 10;
      reasons.push('高蛋白标签加分');
    } else score += 4;

    if (dish.caloriesKcal <= 520) score += 8;
    else score -= 6;
  }

  if (lowCal) {
    if (dish.caloriesKcal <= 300) score += 20;
    else score -= 20;
  }

  let match = 0;
  for (const item of pantry) {
    if ((dish.ingredients || []).some((ing) => ing.includes(item))) match += 1;
  }
  if (match > 0) reasons.push(`食材匹配 ${match} 项`);
  score += match * 8;

  if (dish.needsConfirm) score -= 6;
  if (profile.preferQuick) score += Math.max(0, 18 - dish.prepTimeMin) * 0.8;

  return { score, reasons };
}

function rankDishes(filtered, profile) {
  return [...filtered]
    .map((d) => {
      const detail = scoreDishDetail(d, profile);
      return { ...d, score: detail.score, reasons: detail.reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function makeCombo(ranked) {
  if (!ranked.length) return [];
  const main = ranked.find((d) => ['主菜', '小食', '轻食', '主食'].includes(d.category)) || ranked[0];
  const side = ranked.find((d) => d.id !== main.id && ['配菜', '水果'].includes(d.category));
  const backup = ranked.find((d) => d.id !== main.id && (!side || d.id !== side.id));
  return [main, side, backup].filter(Boolean).slice(0, 3);
}

function renderRecommendation(filtered) {
  if (!filtered.length) {
    els.recommendation.classList.remove('empty');
    els.recommendation.innerHTML = '当前筛选下没有可选菜，请放宽时间或分类条件。';
    return;
  }

  const profile = currentProfile();
  const ranked = rankDishes(filtered, profile);
  const combo = makeCombo(ranked);
  const totalCal = combo.reduce((sum, d) => sum + d.caloriesKcal, 0);

  els.recommendation.classList.remove('empty');
  els.recommendation.innerHTML = `
    <div><strong>今晚推荐菜单</strong></div>
    <ol>
      ${combo.map((d) => `<li>${d.name}（${d.caloriesKcal} kcal，约 ${d.prepTimeMin} 分钟）</li>`).join('')}
    </ol>
    <div class="small">总热量约 <strong>${totalCal} kcal</strong></div>
    <div class="small">Top1 推荐理由：${(ranked[0].reasons || []).slice(0, 3).join('；') || '综合评分最高'}</div>
    <div class="small">备选单品：${ranked.slice(0, 3).map((d) => `${d.name}(${Math.round(d.score)}分)`).join('、')}</div>
  `;
}

function renderPlanPreview(filtered) {
  if (!filtered.length) {
    els.planPreview.innerHTML = '<div class="small">当前筛选下无可用菜品，无法生成方案。</div>';
    return;
  }

  const pantry = getPantry();
  const baseTime = Number(els.timeLimit.value);

  const plans = [
    { key: 'A', title: '方案 A｜均衡稳定', profile: { goal: '均衡', lowCal: false, timeLimit: baseTime, pantry, preferQuick: false } },
    { key: 'B', title: '方案 B｜减脂优先', profile: { goal: '减脂', lowCal: true, timeLimit: Math.min(baseTime, 30), pantry, preferQuick: false } },
    { key: 'C', title: '方案 C｜省时快做', profile: { goal: '均衡', lowCal: false, timeLimit: Math.min(baseTime, 20), pantry, preferQuick: true } }
  ];

  const cards = plans.map((plan) => {
    const ranked = rankDishes(filtered, plan.profile);
    const combo = makeCombo(ranked);
    const totalCal = combo.reduce((sum, d) => sum + d.caloriesKcal, 0);
    return `
      <article class="plan-card">
        <h3>${plan.title}</h3>
        <ol>${combo.map((d) => `<li>${d.name}</li>`).join('')}</ol>
        <div class="plan-meta">总热量约 ${totalCal} kcal · 主推荐 ${ranked[0] ? ranked[0].name : '无'}</div>
      </article>
    `;
  });

  els.planPreview.innerHTML = cards.join('');
}

function currentProfile() {
  return {
    goal: els.goal.value,
    lowCal: els.lowCal.checked,
    timeLimit: Number(els.timeLimit.value),
    pantry: getPantry(),
    preferQuick: els.quickOnly.checked
  };
}

function getPantry() {
  return els.ingredientsInput.value
    .split(/[，,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function renderRandom(filtered) {
  if (!filtered.length) {
    els.recommendation.classList.remove('empty');
    els.recommendation.innerHTML = '当前筛选下没有可选菜，请先放宽筛选条件。';
    return;
  }

  const idx = Math.floor(Math.random() * filtered.length);
  const picked = filtered[idx];
  const detail = scoreDishDetail(picked, currentProfile());
  els.recommendation.classList.remove('empty');
  els.recommendation.innerHTML = `
    <div><strong>随机推荐一道</strong></div>
    <div>${picked.name}（${picked.category}）</div>
    <div class="small">${picked.caloriesKcal} kcal · 约 ${picked.prepTimeMin} 分钟 · 评分 ${Math.round(detail.score)}</div>
    <div class="small">理由：${(detail.reasons || []).slice(0, 3).join('；') || '随机挑选'}</div>
  `;
}

function renderDishList(list) {
  els.dishList.innerHTML = list
    .map((d) => `
      <article class="card">
        <img src="${d.photo}" alt="${d.name}" loading="lazy" />
        <div class="card-body">
          <h3>${d.name}</h3>
          <div class="meta">${d.category} · ${d.prepTimeMin} 分钟 · ${d.caloriesKcal} kcal · ${d.difficulty}</div>
          <div class="tags">
            ${(d.tags || []).map((t) => `<span class="tag">${t}</span>`).join('')}
            ${d.needsConfirm ? '<span class="tag" style="background:#fff7ed;color:#9a3412;">待确认</span>' : ''}
          </div>
          <div><strong>食材</strong></div>
          <ul>${(d.ingredients || []).map((i) => `<li>${i}</li>`).join('')}</ul>
          <div style="margin-top:8px;"><strong>做法</strong></div>
          <ol>${(d.steps || []).map((s) => `<li>${s}</li>`).join('')}</ol>
          <div class="small" style="margin-top:8px;">${d.nutritionNote || ''}</div>
        </div>
      </article>
    `)
    .join('');
}
