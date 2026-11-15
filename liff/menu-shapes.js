// Rich menu cell shapes. Tap areas always stay the plain grid rectangles (menuAreas);
// only the drawing changes. Index = config.shape.
export const SHAPES = ['方塊', '圓角', '拼圖', '拱門', '票券', '花邊'];
const PAPER = '#fffef9';

const columnsOf = (grid) => (grid === 6 ? 3 : 2);

function square(ctx, a) {
  ctx.fillRect(a.x + 4, a.y + 4, a.w - 8, a.h - 8);
}

function rounded(ctx, a) {
  ctx.beginPath();
  ctx.roundRect(a.x + 4, a.y + 4, a.w - 8, a.h - 8, 28);
  ctx.fill();
}

function arch(ctx, a) {
  const r = Math.min(a.w / 2 - 4, a.h * 0.45);
  ctx.beginPath();
  ctx.roundRect(a.x + 4, a.y + 4, a.w - 8, a.h - 8, [r, r, 10, 10]);
  ctx.fill();
}

function ticket(ctx, a) {
  const x0 = a.x + 4,
    y0 = a.y + 4,
    x1 = a.x + a.w - 4,
    y1 = a.y + a.h - 4,
    r = 24;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.arc(x1, y0, r, Math.PI, Math.PI / 2, true);
  ctx.lineTo(x1, y1 - r);
  ctx.arc(x1, y1, r, -Math.PI / 2, Math.PI, true);
  ctx.lineTo(x0 + r, y1);
  ctx.arc(x0, y1, r, 0, -Math.PI / 2, true);
  ctx.lineTo(x0, y0 + r);
  ctx.arc(x0, y0, r, Math.PI / 2, 0, true);
  ctx.closePath();
  ctx.fill();
}

function scallop(ctx, a) {
  const pad = 18,
    r = 12,
    x0 = a.x + pad,
    y0 = a.y + pad,
    w = a.w - 2 * pad,
    h = a.h - 2 * pad;
  ctx.fillRect(x0, y0, w, h);
  const dots = (len) => Math.max(2, Math.round(len / (2.2 * r)));
  ctx.beginPath();
  for (const [sx, sy, dx, dy, len] of [
    [x0, y0, 1, 0, w],
    [x0, y0 + h, 1, 0, w],
    [x0, y0, 0, 1, h],
    [x0 + w, y0, 0, 1, h],
  ]) {
    const n = dots(len);
    for (let i = 0; i <= n; i++) {
      const cx = sx + (dx * len * i) / n,
        cy = sy + (dy * len * i) / n;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/** Knobs for the puzzle shape: one per inner edge, alternating which side owns it. */
export function puzzleKnobs(areas, grid) {
  const cols = columnsOf(grid),
    knobs = [];
  for (const a of areas) {
    const col = a.index % cols,
      row = Math.floor(a.index / cols),
      own = (row + col) % 2 === 0;
    const right = col < cols - 1 ? areas[a.index + 1] : null,
      below = areas[a.index + cols] ?? null;
    // Vertical edges: knob a quarter down, clear of the centred label.
    if (right)
      knobs.push({
        owner: own ? a : right,
        cx: a.x + a.w + (own ? 24 : -24),
        cy: a.y + a.h * 0.25,
        dir: own ? 0 : 180,
        vertical: true,
        edge: a.x + a.w,
        from: a.y,
        len: a.h,
      });
    // Horizontal edges: knob a quarter across.
    if (below)
      knobs.push({
        owner: own ? below : a,
        cx: a.x + a.w * 0.25,
        cy: a.y + a.h + (own ? -24 : 24),
        dir: own ? 270 : 90,
        vertical: false,
        edge: a.y + a.h,
        from: a.x,
        len: a.w,
      });
  }
  return knobs;
}

function puzzle(ctx, areas, grid, colorOf, width, height) {
  for (const a of areas) {
    ctx.fillStyle = colorOf(a);
    ctx.fillRect(a.x, a.y, a.w, a.h);
  }
  const knobs = puzzleKnobs(areas, grid);
  for (const k of knobs) {
    ctx.fillStyle = colorOf(k.owner);
    ctx.beginPath();
    ctx.arc(k.cx, k.cy, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  // 8px paper seams: frame, inner edges with a gap at each knob, and the knob outline.
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 8;
  ctx.lineCap = 'butt';
  ctx.strokeRect(0, 0, width, height);
  for (const k of knobs) {
    const at = (k.vertical ? k.cy : k.cx) - k.from;
    ctx.beginPath();
    for (const [p, q] of [
      [0, at - 18],
      [at + 18, k.len],
    ]) {
      if (k.vertical) {
        ctx.moveTo(k.edge, k.from + p);
        ctx.lineTo(k.edge, k.from + q);
      } else {
        ctx.moveTo(k.from + p, k.edge);
        ctx.lineTo(k.from + q, k.edge);
      }
    }
    ctx.stroke();
    const deg = Math.PI / 180;
    ctx.beginPath();
    ctx.arc(k.cx, k.cy, 30, (k.dir - 143.13) * deg, (k.dir + 143.13) * deg);
    ctx.stroke();
  }
}

const PAINTERS = [square, rounded, null, arch, ticket, scallop];

/** Paint every cell background for `shape` (labels are drawn by the caller). */
export function paintCells(ctx, areas, grid, shape, colorOf, width, height) {
  if (shape === 2) return puzzle(ctx, areas, grid, colorOf, width, height);
  const paint = PAINTERS[shape] ?? square;
  for (const a of areas) {
    ctx.fillStyle = colorOf(a);
    paint(ctx, a);
  }
}
