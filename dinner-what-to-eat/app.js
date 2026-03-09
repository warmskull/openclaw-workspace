let dishes = [];

const els = {
  dishList: document.getElementById('dishList'),
  recommendation: document.getElementById('recommendation'),
  timeLimit: document.getElementById('timeLimit'),
  goal: document.getElementById('goal'),
  category: document.getElementById('category'),
  ingredientsInput: document.getElementById('ingredientsInput'),
  quickOnly: document.getElementById('quickOnly'),
  lowCal: document.getElementById('lowCal'),
  btnRecommend: document.getElementById('btnRecommend'),
  btnReset: document.getElementById('btnReset')
};

init();

async function init() {
  const res = await fetch('/data/dishes.json');
  dishes = await res.json();
  renderDishList(dishes);

  els.btnRecommend.addEventListener('click', () => {
    const filtered = applyFilters(dishes);
    renderDishList(filtered);
    renderRecommendation(filtered);
  });

  els.btnReset.addEventListener('click', () => {
    els.timeLimit.value = '30';
    els.goal.value = '均衡';
    els.category.value = '全部';
    els.ingredientsInput.value = '';
    els.quickOnly.checked = false;
    els.lowCal.checked = false;
    renderDishList(dishes);
    els.recommendation.innerHTML = '点击“给我推荐晚饭”开始';
    els.recommendation.classList.add('empty');
  });
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

function scoreDish(dish) {
  const goal = els.goal.value;
  const lowCal = els.lowCal.checked;
  const timeLimit = Number(els.timeLimit.value);
  const pantry = els.ingredientsInput.value
    .split(/[，,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  let score = 50;

  if (dish.prepTimeMin <= timeLimit) score += 15;
  else score -= 20;

  if (goal === '减脂') {
    score += dish.caloriesKcal <= 300 ? 25 : -15;
  } else if (goal === '补能量') {
    score += dish.caloriesKcal >= 350 ? 20 : -8;
  } else {
    // 均衡
    score += dish.tags.includes('高蛋白') ? 10 : 4;
    score += dish.caloriesKcal <= 450 ? 8 : -6;
  }

  if (lowCal) score += dish.caloriesKcal <= 300 ? 22 : -22;

  let match = 0;
  for (const item of pantry) {
    if (dish.ingredients.some((ing) => ing.includes(item))) match += 1;
  }
  score += match * 8;

  if (dish.category === '水果' || dish.category === '配菜') score += 2;

  return score;
}

function renderRecommendation(filtered) {
  if (!filtered.length) {
    els.recommendation.classList.remove('empty');
    els.recommendation.innerHTML = '当前筛选下没有可选菜，请放宽时间或分类条件。';
    return;
  }

  const ranked = [...filtered]
    .map((d) => ({ ...d, score: scoreDish(d) }))
    .sort((a, b) => b.score - a.score);

  const main = ranked.find((d) => d.category === '主菜' || d.category === '小食') || ranked[0];
  const side = ranked.find((d) => d.id !== main.id && (d.category === '配菜' || d.category === '水果'));
  const backup = ranked.find((d) => d.id !== main.id && (!side || d.id !== side.id));

  const combo = [main, side, backup].filter(Boolean).slice(0, 3);
  const totalCal = combo.reduce((sum, d) => sum + d.caloriesKcal, 0);

  els.recommendation.classList.remove('empty');
  els.recommendation.innerHTML = `
    <div><strong>今晚推荐菜单</strong></div>
    <ol>
      ${combo.map((d) => `<li>${d.name}（${d.caloriesKcal} kcal，约 ${d.prepTimeMin} 分钟）</li>`).join('')}
    </ol>
    <div class="small">总热量约 <strong>${totalCal} kcal</strong>；可按实际饭量减少一份小食或水果。</div>
    <div class="small">备选单品：${ranked.slice(0, 3).map((d) => `${d.name}(${d.score}分)`).join('、')}</div>
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
          <div class="tags">${d.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
          <div><strong>食材</strong></div>
          <ul>${d.ingredients.map((i) => `<li>${i}</li>`).join('')}</ul>
          <div style="margin-top:8px;"><strong>做法</strong></div>
          <ol>${d.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          <div class="small" style="margin-top:8px;">${d.nutritionNote}</div>
        </div>
      </article>
    `)
    .join('');
}
