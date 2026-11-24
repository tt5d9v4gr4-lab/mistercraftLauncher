'use strict';
/* Процедурный пиксельный фон в стиле блочного мира (оригинальная сцена, без ресурсов Minecraft). */
(function () {
  const W = 384, H = 216;
  const canvas = document.getElementById('bg');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let seed = 1337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise1d(len, step) {
    const pts = Array.from({ length: Math.ceil(len / step) + 2 }, () => rnd());
    return (x) => {
      const i = Math.floor(x / step);
      const t = smooth((x % step) / step);
      return pts[i] * (1 - t) + pts[i + 1] * t;
    };
  }

  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const g = layer.getContext('2d');
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  // Небо: закат в чёрно-жёлтых тонах
  const bands = ['#06060a', '#0a0907', '#12100a', '#1d1608', '#2b1e07', '#40290a', '#5b360b', '#7d4a0c', '#a56210', '#d28316', '#f2a91f', '#ffcf3a'];
  const skyH = 150;
  const bh = Math.ceil(skyH / bands.length);
  bands.forEach((c, i) => px(0, i * bh, W, bh + 1, c));

  // Звёзды
  const stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: (rnd() * W) | 0, y: (rnd() * 70) | 0, p: rnd() * 6 });
  stars.forEach((s) => px(s.x, s.y, 1, 1, 'rgba(255,240,200,.8)'));

  // Квадратное «солнце» с ореолом
  const sx = 262, sy = 92;
  [[34, 'rgba(255,200,40,.10)'], [26, 'rgba(255,200,40,.16)'], [20, 'rgba(255,215,70,.28)']].forEach(([s, c]) =>
    px(sx - (s - 16) / 2, sy - (s - 16) / 2, s, s, c));
  px(sx, sy, 16, 16, '#ffe14d');
  px(sx + 2, sy + 2, 12, 12, '#fff3a0');

  // Дальние холмы (силуэт)
  const n1 = noise1d(W, 38);
  for (let x = 0; x < W; x++) {
    const h = 118 + Math.round(n1(x) * 26);
    px(x, h, 1, H - h, '#241705');
  }
  const n2 = noise1d(W, 26);
  for (let x = 0; x < W; x++) {
    const h = 138 + Math.round(n2(x) * 22);
    px(x, h, 1, H - h, '#17100a');
  }

  // Передний план: трава / земля / камень / золотая руда
  const n3 = noise1d(W, 20);
  const heights = [];
  for (let x = 0; x < W; x++) {
    const h = 160 + Math.round(n3(x) * 18);
    heights.push(h);
    px(x, h, 1, 1, '#4f9a22');
    px(x, h + 1, 1, 2, '#3a7a18');
    px(x, h + 3, 1, 14, '#5c3b1b');
    px(x, h + 17, 1, H, '#3b3b3b');
    // «пиксельный шум» блоков
    if (rnd() < 0.18) px(x, h + 3 + ((rnd() * 12) | 0), 1, 1, '#4a2f15');
    if (rnd() < 0.1) px(x, h + 17 + ((rnd() * 30) | 0), 1, 1, '#2c2c2c');
  }
  for (let i = 0; i < 26; i++) {
    const x = (rnd() * (W - 3)) | 0;
    const y = heights[x] + 20 + ((rnd() * 28) | 0);
    px(x, y, 2, 2, '#ffcc00');
    px(x, y, 1, 1, '#fff08a');
  }

  // Деревья из блоков
  for (let i = 0; i < 9; i++) {
    const x = 14 + ((rnd() * (W - 40)) | 0);
    const base = heights[x];
    const th = 12 + ((rnd() * 6) | 0);
    px(x, base - th, 3, th, '#4a2e12');
    const lx = x - 6, ly = base - th - 8;
    px(lx, ly + 4, 15, 8, '#2a5a14');
    px(lx + 3, ly, 9, 5, '#33701a');
    px(lx + 2, ly + 8, 11, 3, '#24500f');
  }

  // Облака
  const clouds = Array.from({ length: 6 }, () => ({
    x: rnd() * W, y: 14 + rnd() * 70, w: 24 + ((rnd() * 36) | 0), s: 0.04 + rnd() * 0.07,
  }));

  let t = 0;
  function frame() {
    t++;
    ctx.drawImage(layer, 0, 0);
    ctx.fillStyle = 'rgba(255,225,150,.22)';
    for (const c of clouds) {
      c.x += c.s;
      if (c.x > W + 10) c.x = -c.w - 10;
      const x = Math.round(c.x), y = Math.round(c.y);
      ctx.fillRect(x, y, c.w, 5);
      ctx.fillRect(x + 6, y - 4, c.w - 14, 4);
      ctx.fillRect(x + 3, y + 5, c.w - 8, 3);
    }
    // Мерцание звёзд
    for (const s of stars) {
      if (((t / 30 + s.p) | 0) % 6 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }
    setTimeout(() => requestAnimationFrame(frame), 33);
  }
  frame();
})();
