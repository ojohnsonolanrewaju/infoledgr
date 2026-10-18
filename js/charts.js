/* InfoLedgr — small dependency-free SVG/HTML charts with hover + tap tooltips */
(function (root) {
  const IL = (root.IL = root.IL || {});
  const { util: U } = IL;
  const NS = 'http://www.w3.org/2000/svg';

  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      document.body.appendChild(tip);
      document.addEventListener('pointerdown', (e) => { if (!e.target.closest('[data-tip-host]')) hideTip(); }, true);
      window.addEventListener('scroll', hideTip, { passive: true });
    }
    return tip;
  }
  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight;
    let left = x + 14, top = y - h - 12;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (left < 8) left = 8;
    if (top < 8) top = y + 16;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const money = (v) => (IL.privacy ? '€••••' : U.fmt(v, 'EUR'));
  const moneyShort = (v) => (IL.privacy ? '•••' : U.fmt(v, 'EUR', { compact: true, decimals: 0 }));

  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  /** Rect with only the data end rounded (r=4), anchored flat on the baseline. */
  function barPath(x, y, w, h, r = 4) {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function svgRoot(container, height, label) {
    container.innerHTML = '';
    container.setAttribute('data-tip-host', '');
    const width = Math.max(260, container.clientWidth || 600);
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img', 'aria-label': label });
    container.appendChild(svg);
    return { svg, width };
  }

  function yAxis(svg, { left, right, top, h, max, ticks = 4 }) {
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      const y = top + h - (v / max) * h;
      el('line', { x1: left, x2: right, y1: y, y2: y, class: i === 0 ? 'c-base' : 'c-grid' }, svg);
      const t = el('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'c-tick' }, svg);
      t.textContent = moneyShort(v);
    }
  }

  const charts = {
    /** Grouped columns: data [{label, sub, values: {key: number}}], series [{key, label, slot}] */
    columns(container, data, series, { height = 220, label = 'Column chart' } = {}) {
      const { svg, width } = svgRoot(container, height, label);
      const m = { l: 46, r: 8, t: 10, b: 24 };
      const w = width - m.l - m.r, h = height - m.t - m.b;
      const max = niceMax(Math.max(100, ...data.flatMap((d) => series.map((s) => d.values[s.key] || 0))));
      yAxis(svg, { left: m.l, right: width - m.r, top: m.t, h, max });
      const band = w / data.length;
      const gap = 2;
      const bw = Math.max(3, Math.min(22, (band * 0.7 - gap * (series.length - 1)) / series.length));
      const groupW = bw * series.length + gap * (series.length - 1);
      const every = data.length > 8 && width < 500 ? 2 : 1;

      data.forEach((d, i) => {
        const gx = m.l + band * i + (band - groupW) / 2;
        series.forEach((s, j) => {
          const v = d.values[s.key] || 0;
          const bh = (v / max) * h;
          el('path', { d: barPath(gx + j * (bw + gap), m.t + h - bh, bw, bh), fill: `var(--s${s.slot})`, class: 'c-bar' }, svg);
        });
        if (i % every === 0 || i === data.length - 1) {
          const t = el('text', { x: m.l + band * i + band / 2, y: height - 6, 'text-anchor': 'middle', class: 'c-tick' }, svg);
          t.textContent = d.label;
        }
        const hit = el('rect', { x: m.l + band * i, y: m.t, width: band, height: h, class: 'c-hit' }, svg);
        const html = `<b>${U.esc(d.sub || d.label)}</b>` + series.map((s) =>
          `<div><i style="background:var(--s${s.slot})"></i>${s.label}<span>${money(d.values[s.key] || 0)}</span></div>`).join('') +
          (d.extra ? `<div class="muted">${d.extra}</div>` : '');
        const on = (e) => { hit.classList.add('on'); showTip(html, e.clientX, e.clientY); };
        hit.addEventListener('pointermove', on);
        hit.addEventListener('pointerdown', on);
        hit.addEventListener('pointerleave', () => { hit.classList.remove('on'); hideTip(); });
      });
    },

    /** Lines over days: series [{label, slot, dashed, points: [{x, y}]}] with crosshair. */
    lines(container, series, { height = 200, xMax, label = 'Line chart', xLabel = (x) => x } = {}) {
      const { svg, width } = svgRoot(container, height, label);
      const m = { l: 46, r: 10, t: 10, b: 24 };
      const w = width - m.l - m.r, h = height - m.t - m.b;
      const max = niceMax(Math.max(100, ...series.flatMap((s) => s.points.map((p) => p.y))));
      xMax = xMax || Math.max(...series.flatMap((s) => s.points.map((p) => p.x)));
      yAxis(svg, { left: m.l, right: width - m.r, top: m.t, h, max });
      const X = (x) => m.l + ((x - 1) / Math.max(1, xMax - 1)) * w;
      const Y = (y) => m.t + h - (y / max) * h;
      [1, Math.ceil(xMax / 2), xMax].forEach((x) => {
        const t = el('text', { x: X(x), y: height - 6, 'text-anchor': x === 1 ? 'start' : x === xMax ? 'end' : 'middle', class: 'c-tick' }, svg);
        t.textContent = xLabel(x);
      });
      series.forEach((s) => {
        if (!s.points.length) return;
        el('path', {
          d: s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(''),
          class: 'c-line', stroke: `var(--s${s.slot})`, 'stroke-dasharray': s.dashed ? '5 4' : 'none',
        }, svg);
        const lp = s.points[s.points.length - 1];
        el('circle', { cx: X(lp.x), cy: Y(lp.y), r: 4, fill: `var(--s${s.slot})`, class: 'c-dot' }, svg);
      });
      const cross = el('line', { y1: m.t, y2: m.t + h, class: 'c-cross', style: 'display:none' }, svg);
      const dots = series.map((s) => el('circle', { r: 4, fill: `var(--s${s.slot})`, class: 'c-dot', style: 'display:none' }, svg));
      const hit = el('rect', { x: m.l, y: m.t, width: w, height: h, class: 'c-hit' }, svg);
      const move = (e) => {
        const r = svg.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * width;
        const x = Math.min(xMax, Math.max(1, Math.round(1 + ((px - m.l) / w) * (xMax - 1))));
        cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.style.display = '';
        let html = `<b>${U.esc(xLabel(x, true))}</b>`;
        series.forEach((s, i) => {
          const p = s.points.find((q) => q.x === x);
          if (!p) { dots[i].style.display = 'none'; return; }
          dots[i].setAttribute('cx', X(x)); dots[i].setAttribute('cy', Y(p.y)); dots[i].style.display = '';
          html += `<div><i style="background:var(--s${s.slot})"></i>${s.label}<span>${money(p.y)}</span></div>`;
        });
        showTip(html, e.clientX, e.clientY);
      };
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerdown', move);
      hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; dots.forEach((d) => (d.style.display = 'none')); hideTip(); });
    },

    /** Donut for a few fixed-slot parts: items [{label, value, slot}] */
    donut(container, items, { size = 168, center = '', centerSub = '', label = 'Donut chart' } = {}) {
      container.innerHTML = '';
      container.setAttribute('data-tip-host', '');
      const total = U.sum(items, (i) => i.value);
      const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': label });
      container.appendChild(svg);
      const cx = size / 2, R = size / 2 - 2, r = R - 22;
      if (total <= 0) {
        el('circle', { cx, cy: cx, r: (R + r) / 2, fill: 'none', 'stroke-width': R - r, class: 'c-empty' }, svg);
      } else {
        let a0 = -Math.PI / 2;
        const parts = items.filter((i) => i.value > 0);
        parts.forEach((it) => {
          const a1 = a0 + (it.value / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const pt = (rad, a) => `${cx + rad * Math.cos(a)},${cx + rad * Math.sin(a)}`;
          const full = parts.length === 1;
          const d = full
            ? `M${cx},${cx - R}A${R},${R} 0 1 1 ${cx - 0.01},${cx - R}L${cx - 0.01},${cx - r}A${r},${r} 0 1 0 ${cx},${cx - r}Z`
            : `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
          const p = el('path', { d, fill: `var(--s${it.slot})`, class: 'c-seg' }, svg);
          const html = `<div><i style="background:var(--s${it.slot})"></i>${U.esc(it.label)}<span>${money(it.value)}</span></div><div class="muted">${Math.round((it.value / total) * 100)}% of spending</div>`;
          const on = (e) => showTip(html, e.clientX, e.clientY);
          p.addEventListener('pointermove', on);
          p.addEventListener('pointerdown', on);
          p.addEventListener('pointerleave', hideTip);
          a0 = a1;
        });
      }
      const t1 = el('text', { x: cx, y: cx + 2, 'text-anchor': 'middle', class: 'c-center' }, svg);
      t1.textContent = center;
      const t2 = el('text', { x: cx, y: cx + 20, 'text-anchor': 'middle', class: 'c-center-sub' }, svg);
      t2.textContent = centerSub;
    },

    /** Calendar heatmap of daily spend (sequential blue, Monday-first). */
    calendar(container, days, ym, { onPick } = {}) {
      const max = Math.max(1, ...days.map((d) => d.amount));
      const [y, m] = ym.split('-').map(Number);
      const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
      const steps = [100, 200, 300, 400, 500, 600];
      const today = U.today();
      let html = '<div class="cal">' + ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="cal-h">${d}</div>`).join('');
      html += '<div></div>'.repeat(offset);
      days.forEach((d) => {
        const date = `${ym}-${String(d.day).padStart(2, '0')}`;
        const step = d.amount > 0 ? steps[Math.min(steps.length - 1, Math.floor((d.amount / max) * steps.length))] : 0;
        const future = date > today;
        html += `<button class="cal-d${step >= 400 ? ' dark' : ''}${future ? ' future' : ''}${date === today ? ' today' : ''}"
          style="${step ? `background:var(--seq-${step})` : ''}" data-date="${date}"
          data-tip="${U.esc(`<b>${U.dayLabel(date)}</b><div>${d.count} payment${d.count === 1 ? '' : 's'}<span>${money(d.amount)}</span></div>`)}"
          aria-label="${date}: ${money(d.amount)}">${d.day}</button>`;
      });
      html += '</div><div class="cal-key"><span>Less</span>' + steps.map((s) => `<i style="background:var(--seq-${s})"></i>`).join('') + '<span>More</span></div>';
      container.innerHTML = html;
      container.setAttribute('data-tip-host', '');
      container.querySelectorAll('.cal-d').forEach((b) => {
        b.addEventListener('pointerenter', (e) => showTip(b.dataset.tip, e.clientX, e.clientY));
        b.addEventListener('pointerleave', hideTip);
        b.addEventListener('click', () => onPick && onPick(b.dataset.date));
      });
    },

    /** Horizontal ranked bars (HTML) — one hue; identity comes from the label, not colour. */
    ranked(container, items, { onPick, max } = {}) {
      max = max || Math.max(1, ...items.map((i) => i.value));
      container.innerHTML = items.length ? items.map((it, i) => `
        <button class="rank" data-i="${i}">
          <span class="rank-ico">${it.icon || ''}</span>
          <span class="rank-body">
            <span class="rank-top"><span class="rank-label">${U.esc(it.label)}</span><span class="rank-val money">${money(it.value)}</span></span>
            <span class="rank-track"><span class="rank-fill" style="width:${Math.max(1.5, (it.value / max) * 100)}%"></span></span>
            ${it.sub ? `<span class="rank-sub">${it.sub}</span>` : ''}
          </span>
        </button>`).join('') : '<p class="empty">Nothing here yet.</p>';
      if (onPick) container.querySelectorAll('.rank').forEach((b) => b.addEventListener('click', () => onPick(items[b.dataset.i])));
    },

    hideTip,
  };

  IL.charts = charts;
})(window);
