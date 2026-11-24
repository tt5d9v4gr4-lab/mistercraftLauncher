'use strict';
/* Фон Medieval Fantasy: замок, дракон, тёмный лес, луна, парящие руны (рисуется кодом, оригинальная сцена). */
(function () {
  const W = 384, H = 216;
  const canvas = document.getElementById('mf-bg');
  if (!canvas) return;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const layer = document.createElement('canvas');
  layer.width = W; layer.height = H;
  const g = layer.getContext('2d');
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  // Небо: сумерки от фиолетового к багровому
  const bands = ['#06030d', '#0b0516', '#120820', '#1a0b2c', '#260e38', '#361242', '#4d1647', '#6d1c49', '#922640', '#b93c38', '#d9622f'];
  const bh = Math.ceil(150 / bands.length);
  bands.forEach((c, i) => px(0, i * bh, W, bh + 1, c));

  const stars = Array.from({ length: 90 }, () => ({ x: (rnd() * W) | 0, y: (rnd() * 80) | 0, p: rnd() * 8 }));
  stars.forEach((s) => px(s.x, s.y, 1, 1, 'rgba(255,235,210,.85)'));

  // Луна с ореолом
  const mx = 96, my = 52;
  for (let r = 30; r >= 16; r -= 4) {
    g.fillStyle = `rgba(255,214,150,${(30 - r) / 140 + 0.03})`;
    g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#ffe9b8'; g.beginPath(); g.arc(mx, my, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e7c98f';
  [[-4, -3, 3], [4, 2, 2], [-2, 5, 2]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(mx + dx, my + dy, r, 0, Math.PI * 2); g.fill(); });

  // Горы
  const hills = (base, amp, step, col) => {
    const pts = Array.from({ length: Math.ceil(W / step) + 2 }, () => rnd());
    for (let x = 0; x < W; x++) {
      const i = Math.floor(x / step), t = (x % step) / step, s = t * t * (3 - 2 * t);
      const h = base + Math.round((pts[i] * (1 - s) + pts[i + 1] * s) * amp);
      px(x, h, 1, H - h, col);
    }
  };
  hills(112, 34, 46, '#2a1238');
  hills(132, 26, 34, '#1d0d2a');

  // Замок на холме справа
  const cx = 250, cy = 118, c1 = '#120a1c', c2 = '#1a0f26';
  px(cx - 70, cy + 14, 150, 40, c1);
  const tower = (x, y, w, h, roof) => {
    px(x, y, w, h, c1);
    for (let i = 0; i < w; i += 4) px(x + i, y - 3, 2, 3, c1);
    if (roof) for (let r = 0; r < 12; r++) px(x - 2 + r, y - 3 - r, w + 4 - r * 2, 1, c2);
  };
  tower(cx - 12, cy - 20, 24, 40, false);
  tower(cx - 8, cy - 40, 16, 22, true);
  tower(cx - 62, cy - 4, 14, 32, true);
  tower(cx + 48, cy - 8, 14, 36, true);
  tower(cx - 38, cy + 6, 12, 22, false);
  tower(cx + 28, cy + 4, 12, 24, false);
  px(cx - 28, cy + 8, 60, 16, c1);
  const flagPoles = [[cx, cy - 66], [cx - 55, cy - 28], [cx + 55, cy - 32]];
  flagPoles.forEach(([x, y]) => { px(x, y, 1, 10, '#0a0612'); px(x + 1, y, 5, 3, '#a02c3f'); });
  const windows = [[cx - 3, cy - 32], [cx - 4, cy - 10], [cx + 3, cy - 10], [cx - 58, cy + 6], [cx + 52, cy + 4], [cx - 34, cy + 14], [cx + 32, cy + 12], [cx - 10, cy + 12], [cx + 8, cy + 14]];

  // Лес: два слоя тёмных елей
  const pines = (y0, hMin, hMax, col, count) => {
    for (let i = 0; i < count; i++) {
      const x = (rnd() * (W + 20)) - 10, h = hMin + rnd() * (hMax - hMin), w = h * 0.45;
      px(x - 1, y0 - 3, 2, 6, col);
      for (let r = 0; r < h; r += 3) { const ww = Math.max(1, Math.round((w * (r + 2)) / h)); px(x - ww / 2, y0 - h + r, ww, 3, col); }
    }
  };
  px(0, 176, W, 40, '#0d0716');
  pines(178, 22, 40, '#130a1f', 34);
  px(0, 190, W, 30, '#08040e');
  pines(196, 26, 52, '#08040e', 28);

  // Дракон (спрайт 20×9, два кадра взмаха)
  const DR = [
    ['....X.........X....', '...XX.........XX...', '..XXXX.......XXXX..', '.XXXXXX..X..XXXXXX.', 'XXXXXXXXXXXXXXXXXXX', '..XXXXXXXXXXXXXXXXXX', '.......XXXXXXX..XX.X', '........XXXXX........', '.........XX..........'],
    ['...................', '...................', '..X.............X..', '.XXX..X.....X..XXX.', 'XXXXXXXXXXXXXXXXXXX', '.XXXXXXXXXXXXXXXXXXX', '.......XXXXXXX..XX.X', '........XXXXX........', '.........XX..........'],
  ];
  const drawDragon = (x, y, f) => {
    ctx.fillStyle = '#07030c';
    DR[f].forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'X') ctx.fillRect(Math.round(x) + rx, Math.round(y) + ry, 1, 1); }));
  };

  // Руны (пиксельные знаки)
  const RUNES = [
    ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
    ['X....', 'XXX..', 'X..X.', 'X.X..', 'X....'],
    ['..X..', '.XX..', 'X.X..', '..XX.', '..X..'],
    ['X.X.X', '.XXX.', '..X..', '.XXX.', 'X.X.X'],
    ['XXX..', 'X..X.', 'XXX..', 'X..X.', 'X..X.'],
    ['.XXX.', 'X...X', '..X..', '.X.X.', 'X...X'],
  ];
  const runes = Array.from({ length: 14 }, () => ({ x: rnd() * W, y: 40 + rnd() * 150, v: 0.08 + rnd() * 0.12, r: (rnd() * RUNES.length) | 0, p: rnd() * 6.28 }));
  const fog = Array.from({ length: 5 }, () => ({ x: rnd() * W, y: 150 + rnd() * 40, w: 80 + rnd() * 120, s: 0.05 + rnd() * 0.1 }));

  let t = 0, dx = -30, running = false;
  function frame() {
    if (!running) return;
    t++;
    ctx.drawImage(layer, 0, 0);
    for (const s of stars) if (((t / 25 + s.p) | 0) % 7 === 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(s.x, s.y, 1, 1); }
    // окна замка мерцают
    windows.forEach(([x, y], i) => { ctx.fillStyle = ((t / 20 + i * 3) | 0) % 9 === 0 ? '#a8741a' : '#ffcc00'; ctx.fillRect(x, y, 2, 3); });
    // дракон пролетает на фоне луны
    dx += 0.28; if (dx > W + 30) dx = -30;
    drawDragon(dx, 40 + Math.sin(t / 30) * 6, ((t / 12) | 0) % 2);
    // туман
    ctx.fillStyle = 'rgba(180,120,200,.07)';
    for (const f of fog) { f.x += f.s; if (f.x > W) f.x = -f.w; ctx.fillRect(Math.round(f.x), Math.round(f.y), Math.round(f.w), 6); }
    // руны
    for (const r of runes) {
      r.y -= r.v; if (r.y < 20) { r.y = 190; r.x = Math.random() * W; }
      const a = 0.25 + 0.3 * Math.sin(t / 40 + r.p);
      ctx.fillStyle = `rgba(255,204,0,${Math.max(0.05, a)})`;
      RUNES[r.r].forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'X') ctx.fillRect(Math.round(r.x) + rx, Math.round(r.y) + ry, 1, 1); }));
    }
    setTimeout(() => requestAnimationFrame(frame), 33);
  }
  ctx.drawImage(layer, 0, 0);
  window.MFBg = {
    start() { if (!running) { running = true; frame(); } },
    stop() { running = false; },
  };
})();
