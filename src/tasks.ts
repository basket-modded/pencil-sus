/**
 * Task minigames. Every one is a small hand-drawn canvas toy.
 */
import type { TaskKind } from './shared/map';
import { pencilRect, pencilStroke, pencilText, rand, randRange } from './render/textures';
import { sfx } from './audio';

const W = 560;
const H = 380;
const GRAPHITE = '#2c2b33';

interface Pt {
  x: number;
  y: number;
}

export interface TaskGame {
  canvas: HTMLCanvasElement;
  stop(): void;
}

function sketchButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, active: boolean) {
  ctx.save();
  if (active) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#c9b98f';
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, w, h, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  pencilRect(ctx, x, y, w, h, { width: 2.6, alpha: 0.85, amp: 1.4 });
  pencilText(ctx, label, x + w / 2, y + h / 2, 22, { alpha: 0.9 });
  ctx.restore();
}

export function createTaskGame(kind: TaskKind, label: string, onDone: () => void): TaskGame {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.className = 'task-canvas';
  const ctx = canvas.getContext('2d')!;
  const pointer = { x: 0, y: 0, down: false, id: -1 };
  let finished = false;
  let t = 0;
  let raf = 0;

  const local = (ev: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };

  let closed = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    sfx.task();
    setTimeout(() => {
      if (!closed) onDone();
    }, 480);
  };

  // ---------------------------------------------------------------- wires ---
  const wireColors = ['#c73a2c', '#2f6fc0', '#c99a1f', '#3f9e63'];
  const wireOrder = [2, 0, 3, 1];
  const wireLinks = new Map<number, number>();
  let wireDrag: { from: number; x: number; y: number } | null = null;
  const wireLY = [86, 152, 218, 284];
  const wireRY = [86, 152, 218, 284];

  // ---------------------------------------------------------------- swipe ---
  let cardY = 262;
  let cardDrag = false;
  let swipeStart = 0;
  let swipeMsg = '';
  let swipeMsgUntil = 0;
  let swipeOk = false;

  // ----------------------------------------------------------------- dial ---
  const dials = [0, 1, 2].map((i) => ({
    x: 120 + i * 160,
    y: 190,
    speed: (0.9 + rand()) * (rand() > 0.5 ? 1 : -1),
    angle: rand() * Math.PI * 2,
    target: rand() * Math.PI * 2,
    width: 0.42,
    locked: false,
    penalty: 0,
  }));

  // ----------------------------------------------------------------- fuel ---
  let fuel = 0;
  let pumpDown = false;

  // ---------------------------------------------------------------- trash ---
  const trashItems = Array.from({ length: 6 }, (_, i) => ({
    x: 90 + rand() * 190,
    y: 90 + (i % 3) * 84 + rand() * 24,
    r: 26,
    gone: false,
    drag: false,
  }));

  const draw = () => {
    t += 1 / 60;
    ctx.clearRect(0, 0, W, H);

    if (kind === 'wires') {
      pencilText(ctx, label, W / 2, 34, 24, { alpha: 0.9 });
      // panel
      pencilRect(ctx, 34, 62, W - 68, 292, { width: 3, alpha: 0.8 });
      pencilText(ctx, 'FIX WIRING', W / 2, 348, 20, { alpha: 0.55 });
      for (let i = 0; i < 4; i++) {
        const ly = wireLY[i];
        ctx.save();
        ctx.fillStyle = wireColors[i];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(80, ly, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = GRAPHITE;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
        // soldered wire stub
        pencilStroke(ctx, 95, ly, 130, ly, { width: 5, alpha: 0.7, color: wireColors[i] });
      }
      for (let i = 0; i < 4; i++) {
        const ry = wireRY[i];
        const colorIdx = wireOrder[i];
        ctx.save();
        ctx.fillStyle = wireColors[colorIdx];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(W - 80, ry, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = GRAPHITE;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        ctx.restore();
        pencilStroke(ctx, W - 95, ry, W - 130, ry, { width: 5, alpha: 0.7, color: wireColors[colorIdx] });
      }
      for (const [from, to] of wireLinks) {
        const a = { x: 130, y: wireLY[from] };
        const b = { x: W - 130, y: wireRY[to] };
        ctx.save();
        ctx.strokeStyle = wireColors[from];
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(a.x + 80, a.y + 30, b.x - 80, b.y + 30, b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = GRAPHITE;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
      }
      if (wireDrag) {
        ctx.save();
        ctx.strokeStyle = wireColors[wireDrag.from];
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(80, wireLY[wireDrag.from]);
        ctx.quadraticCurveTo((80 + wireDrag.x) / 2, wireDrag.y - 40, wireDrag.x, wireDrag.y);
        ctx.stroke();
        ctx.restore();
      }
    } else if (kind === 'swipe') {
      pencilText(ctx, label, W / 2, 34, 24, { alpha: 0.9 });
      pencilText(ctx, 'SLIDE THE CARD — not too fast', W / 2, 72, 20, { alpha: 0.6 });
      // track
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (let y = 120; y < 320; y += 22) {
        ctx.strokeStyle = '#8d8676';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 120, y);
        ctx.lineTo(W / 2 - 100, y);
        ctx.moveTo(W / 2 + 100, y);
        ctx.lineTo(W / 2 + 120, y);
        ctx.stroke();
      }
      ctx.restore();
      // card
      const cx = W / 2;
      ctx.save();
      ctx.translate(cx, cardY);
      ctx.rotate(-0.02);
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#fbf7ea';
      ctx.beginPath();
      ctx.roundRect(-92, -58, 184, 116, 10);
      ctx.fill();
      pencilRect(ctx, -92, -58, 184, 116, { width: 3 });
      pencilText(ctx, 'PENCIL SUS', 0, -28, 22, { alpha: 0.9 });
      pencilText(ctx, 'crew id', 0, 2, 18, { alpha: 0.55 });
      ctx.fillStyle = '#c73a2c';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(-70, 22, 50, 18);
      ctx.restore();
      if (swipeOk) pencilText(ctx, 'ACCEPTED', W / 2, 340, 26, { alpha: 0.8, color: '#2c7a4b' });
      else if (swipeMsg && t < swipeMsgUntil) pencilText(ctx, swipeMsg, W / 2, 340, 24, { alpha: 0.85, color: '#c73a2c' });
      pencilText(ctx, 'DRAG UP', W / 2, 100, 18, { alpha: 0.4 });
    } else if (kind === 'dial') {
      pencilText(ctx, label, W / 2, 34, 24, { alpha: 0.9 });
      pencilText(ctx, 'CLICK WHEN THE NEEDLE IS IN THE ZONE', W / 2, 70, 17, { alpha: 0.55 });
      dials.forEach((d, i) => {
        d.angle += d.speed * 0.02;
        if (d.penalty > 0) d.penalty -= 0.016;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#fbf7ea';
        ctx.beginPath();
        ctx.arc(0, 0, 62, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = GRAPHITE;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 62, 0, Math.PI * 2);
        ctx.stroke();
        // target arc
        ctx.globalAlpha = d.locked ? 0.55 : 0.3;
        ctx.strokeStyle = d.locked ? '#2c7a4b' : '#c99a1f';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(0, 0, 50, d.target - d.width, d.target + d.width);
        ctx.stroke();
        // needle
        ctx.globalAlpha = 1;
        ctx.strokeStyle = d.locked ? '#2c7a4b' : '#c73a2c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(d.angle) * 54, Math.sin(d.angle) * 54);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fillStyle = GRAPHITE;
        ctx.fill();
        if (d.locked) pencilText(ctx, 'OK', 0, 28, 20, { alpha: 0.8, color: '#2c7a4b' });
        ctx.restore();
      });
    } else if (kind === 'fuel') {
      pencilText(ctx, label, W / 2, 34, 24, { alpha: 0.9 });
      const tankX = 130;
      const tankY = 90;
      const tankW = 180;
      const tankH = 220;
      // tank
      ctx.save();
      pencilRect(ctx, tankX, tankY, tankW, tankH, { width: 3 });
      const level = Math.min(1, fuel / 100);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#3f8fbf';
      ctx.beginPath();
      ctx.roundRect(tankX + 8, tankY + tankH - 8 - (tankH - 16) * level, tankW - 16, (tankH - 16) * level, 6);
      ctx.fill();
      // wavy fuel surface
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#2f6f9e';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      const sy = tankY + tankH - 8 - (tankH - 16) * level;
      for (let x = 0; x <= tankW - 16; x += 8) {
        const y = sy + Math.sin(x * 0.08 + t * 4) * 2.4;
        x === 0 ? ctx.moveTo(tankX + 8 + x, y) : ctx.lineTo(tankX + 8 + x, y);
      }
      ctx.stroke();
      ctx.restore();
      pencilText(ctx, `${Math.round(fuel)}%`, tankX + tankW / 2, tankY - 16, 20, { alpha: 0.7 });
      // pump button
      const bx = 370;
      const by = 150;
      sketchButton(ctx, bx, by, 150, 90, 'PUMP', pumpDown);
      ctx.save();
      ctx.globalAlpha = 0.5;
      pencilText(ctx, 'HOLD', bx + 75, by + 112, 18, { alpha: 0.5 });
      ctx.restore();
      if (fuel >= 100) pencilText(ctx, 'TANK FULL', W / 2, 348, 26, { alpha: 0.85, color: '#2c7a4b' });
    } else {
      // trash
      pencilText(ctx, label, W / 2, 34, 24, { alpha: 0.9 });
      pencilText(ctx, 'DRAG THE SCRAPS INTO THE CHUTE', W / 2, 70, 17, { alpha: 0.55 });
      // chute
      pencilRect(ctx, W - 190, 100, 150, 210, { width: 3 });
      ctx.save();
      ctx.globalAlpha = 0.14;
      for (let i = 0; i < 16; i++) {
        ctx.strokeStyle = GRAPHITE;
        ctx.beginPath();
        ctx.moveTo(W - 180, 110 + i * 13);
        ctx.lineTo(W - 50, 110 + i * 13 + (i % 2 ? 6 : -6));
        ctx.stroke();
      }
      ctx.restore();
      pencilText(ctx, 'CHUTE', W - 115, 330, 20, { alpha: 0.6 });
      for (const item of trashItems) {
        if (item.gone) continue;
        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.x * 0.01);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#f4efdf';
        ctx.beginPath();
        ctx.arc(0, 0, item.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = GRAPHITE;
        ctx.lineWidth = 2.6;
        ctx.stroke();
        // crumple lines
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(-item.r * 0.6, -item.r * 0.4 + i * 8);
          ctx.lineTo(item.r * 0.5, -item.r * 0.5 + i * 9);
          ctx.stroke();
        }
        ctx.restore();
      }
      const remaining = trashItems.filter((i) => !i.gone).length;
      pencilText(ctx, `${remaining} left`, W / 2, 348, 20, { alpha: 0.55 });
    }

    // global vignette to make it feel pencilled-in
    if (!finished) raf = requestAnimationFrame(draw);
  };

  const onDown = (ev: PointerEvent) => {
    const p = local(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.down = true;
    pointer.id = ev.pointerId;
    canvas.setPointerCapture?.(ev.pointerId);
    sfx.tick();

    if (kind === 'wires') {
      for (let i = 0; i < 4; i++) {
        if (wireLinks.has(i)) continue;
        if (Math.hypot(p.x - 80, p.y - wireLY[i]) < 34) {
          wireDrag = { from: i, x: p.x, y: p.y };
          break;
        }
      }
    } else if (kind === 'swipe') {
      const cx = W / 2;
      if (Math.abs(p.x - cx) < 100 && Math.abs(p.y - cardY) < 62) {
        cardDrag = true;
        swipeStart = performance.now();
        swipeMsg = '';
      }
    } else if (kind === 'dial') {
      dials.forEach((d, i) => {
        if (d.locked || d.penalty > 0) return;
        if (Math.hypot(p.x - d.x, p.y - d.y) > 66) return;
        let diff = Math.atan2(Math.sin(d.angle - d.target), Math.cos(d.angle - d.target));
        if (Math.abs(diff) < d.width) {
          d.locked = true;
          sfx.tick();
          if (dials.every((x) => x.locked)) finish();
        } else {
          d.penalty = 0.4;
          d.angle += 1.2;
          sfx.error();
          swipeMsg = '';
        }
        void i;
      });
    } else if (kind === 'fuel') {
      if (p.x > 370 && p.x < 520 && p.y > 150 && p.y < 240) pumpDown = true;
    } else {
      for (const item of trashItems) {
        if (item.gone) continue;
        if (Math.hypot(p.x - item.x, p.y - item.y) < item.r + 10) {
          item.drag = true;
          break;
        }
      }
    }
  };

  const onMove = (ev: PointerEvent) => {
    const p = local(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    if (kind === 'wires' && wireDrag) {
      wireDrag.x = p.x;
      wireDrag.y = p.y;
    } else if (kind === 'swipe' && cardDrag) {
      cardY = Math.max(120, Math.min(280, p.y));
    } else if (kind === 'trash') {
      for (const item of trashItems) {
        if (item.drag && !item.gone) {
          item.x = p.x;
          item.y = p.y;
        }
      }
    }
  };

  const onUp = (ev: PointerEvent) => {
    const p = local(ev);
    pointer.down = false;
    if (kind === 'wires' && wireDrag) {
      for (let i = 0; i < 4; i++) {
        if (wireLinks.has(wireDrag.from) || [...wireLinks.values()].includes(i)) continue;
        if (Math.hypot(p.x - (W - 80), p.y - wireRY[i]) < 40) {
          if (wireOrder[i] === wireDrag.from) {
            wireLinks.set(wireDrag.from, i);
            sfx.tick();
            if (wireLinks.size === 4) finish();
          } else {
            sfx.error();
          }
        }
      }
      wireDrag = null;
    } else if (kind === 'swipe' && cardDrag) {
      cardDrag = false;
      const dur = (performance.now() - swipeStart) / 1000;
      if (cardY < 150 && dur > 0.22 && dur < 1.4) {
        swipeOk = true;
        finish();
      } else {
        swipeMsg = cardY >= 150 ? 'REACH THE TOP' : dur <= 0.22 ? 'TOO FAST!' : 'TOO SLOW!';
        swipeMsgUntil = t + 2.5;
        cardY = 262;
        sfx.error();
      }
    } else if (kind === 'fuel') {
      pumpDown = false;
    } else if (kind === 'trash') {
      for (const item of trashItems) {
        item.drag = false;
        if (!item.gone && item.x > W - 200 && item.x < W - 30 && item.y > 90 && item.y < 320) {
          item.gone = true;
          sfx.scribble();
          if (trashItems.every((i) => i.gone)) finish();
        }
      }
    }
  };

  // fuel needs a continuous pump
  const pumpTimer = setInterval(() => {
    if (kind !== 'fuel' || finished) return;
    if (pumpDown) {
      fuel = Math.min(100, fuel + 1.7);
      if (fuel >= 100) {
        pumpDown = false;
        finish();
      }
    }
  }, 30);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  raf = requestAnimationFrame(draw);

  return {
    canvas,
    stop() {
      closed = true;
      cancelAnimationFrame(raf);
      clearInterval(pumpTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
  };
}
