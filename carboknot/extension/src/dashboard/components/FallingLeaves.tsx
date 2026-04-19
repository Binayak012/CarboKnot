import { useEffect, useRef } from 'react';

/* =============================================================
   FallingLeaves — ambient backdrop
   -------------------------------------------------------------
   Pseudo-3D falling leaves rendered to a single canvas behind the
   UI. Cheap (cached sprites + raf), respects prefers-reduced-motion,
   pauses when tab is hidden, and re-tints itself when the global
   data-theme attribute flips between dark and light.
   ============================================================= */

type Leaf = {
  x: number;
  y: number;
  z: number; // 0..1 depth; affects size, opacity, fall speed
  rot: number;
  rotV: number;
  tilt: number; // simulates 3D rotation around the leaf's long axis
  tiltV: number;
  swayPhase: number;
  swayAmp: number;
  fall: number;
  size: number;
  colorIdx: number;
};

// Lime-leaning greens for the dark theme (will sit *above* the near-black grid bg).
const DARK_PALETTE = ['#b6ff3c', '#7ed957', '#4f9e3a', '#cffb6f'];
// Deeper forest greens for the lime light theme.
const LIGHT_PALETTE = ['#1d3a1a', '#2c5226', '#3d6e2f', '#4a7a3a'];

function readTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  const t = document.documentElement.dataset.theme;
  return t === 'light' ? 'light' : 'dark';
}

// Build a small offscreen canvas with one leaf shape rendered in `color`.
// We draw the sprites once and re-stamp them every frame; way cheaper than
// re-tracing 30+ bezier paths per frame.
function buildSprite(color: string, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // Extra vertical padding so the stem isn't clipped after rotation.
  const padX = 6;
  const padY = 12;
  c.width = size + padX * 2;
  c.height = size + padY * 2;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.translate(c.width / 2, c.height / 2);

  const w = size * 0.5;
  const h = size * 0.88;
  const stem = size * 0.18;

  // --- stem (drawn first so the leaf body covers its top end) ---
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.2, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, h / 2 - 1);
  // gentle curve so it doesn't look like a toothpick
  ctx.quadraticCurveTo(size * 0.05, h / 2 + stem * 0.55, 0, h / 2 + stem);
  ctx.stroke();

  // --- leaf body: pointed at top and bottom (almond / lanceolate) ---
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.bezierCurveTo(w * 1.05, -h * 0.2, w * 0.95, h * 0.25, 0, h / 2);
  ctx.bezierCurveTo(-w * 0.95, h * 0.25, -w * 1.05, -h * 0.2, 0, -h / 2);
  ctx.fill();

  // central vein
  ctx.strokeStyle = 'rgba(0,0,0,0.24)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2 + 2);
  ctx.lineTo(0, h / 2 - 2);
  ctx.stroke();

  // side veins
  ctx.lineWidth = 0.6;
  for (let i = -2; i <= 2; i++) {
    const y = (i / 5) * h * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.25, y + h * 0.05, w * 0.4, y + h * 0.08, w * 0.45, y + h * 0.06);
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(-w * 0.25, y + h * 0.05, -w * 0.4, y + h * 0.08, -w * 0.45, y + h * 0.06);
    ctx.stroke();
  }

  return c;
}

export type FallingLeavesProps = {
  /** Leaves per pixel² of viewport. Tuned for ~24-36 on a typical laptop. */
  density?: number;
  /** Master opacity multiplier on top of per-leaf depth alpha. */
  intensity?: number;
};

export function FallingLeaves({ density = 0.00004, intensity = 1 }: FallingLeavesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let theme = readTheme();
    let palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
    let sprites: HTMLCanvasElement[] = palette.map((c) => buildSprite(c, 72));
    canvas.style.mixBlendMode = theme === 'light' ? 'multiply' : 'screen';

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = window.innerWidth;
    let H = window.innerHeight;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const makeLeaf = (startAbove: boolean): Leaf => {
      const z = Math.random();
      return {
        x: Math.random() * W,
        y: startAbove ? -40 - Math.random() * H * 0.4 : Math.random() * H,
        z,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.012,
        tilt: Math.random() * Math.PI * 2,
        tiltV: (Math.random() - 0.5) * 0.022 + 0.006,
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 18 + Math.random() * 55,
        fall: 0.18 + Math.random() * 0.5 + z * 0.7,
        size: 16 + Math.random() * 26 + z * 18,
        colorIdx: Math.floor(Math.random() * palette.length)
      };
    };

    let leaves: Leaf[] = [];
    const seed = () => {
      const target = Math.max(10, Math.min(48, Math.round(W * H * density)));
      leaves = Array.from({ length: target }, () => makeLeaf(false));
    };

    resize();
    seed();

    let rafId = 0;
    let last = performance.now();

    const draw = (t: number) => {
      const dt = Math.min(48, t - last);
      last = t;

      ctx.clearRect(0, 0, W, H);

      for (const lf of leaves) {
        lf.y += lf.fall * dt * 0.05;
        lf.rot += lf.rotV * dt * 0.06;
        lf.tilt += lf.tiltV * dt * 0.06;

        const drawX = lf.x + Math.sin(t * 0.0006 + lf.swayPhase) * lf.swayAmp;

        if (lf.y > H + 80) {
          const next = makeLeaf(true);
          // keep horizontal stratification varied as we recycle
          lf.x = next.x;
          lf.y = next.y;
          lf.z = next.z;
          lf.rot = next.rot;
          lf.rotV = next.rotV;
          lf.tilt = next.tilt;
          lf.tiltV = next.tiltV;
          lf.swayPhase = next.swayPhase;
          lf.swayAmp = next.swayAmp;
          lf.fall = next.fall;
          lf.size = next.size;
          lf.colorIdx = next.colorIdx;
          continue;
        }

        const sprite = sprites[lf.colorIdx];
        const baseScale = (0.45 + lf.z * 0.95) * (lf.size / 72);
        const tiltY = Math.max(0.16, Math.abs(Math.cos(lf.tilt)));
        const alpha = (0.08 + lf.z * 0.22) * intensity;

        ctx.save();
        ctx.translate(drawX, lf.y);
        ctx.rotate(lf.rot);
        ctx.scale(baseScale, baseScale * tiltY);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
        ctx.restore();
      }

      if (!reduced) rafId = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(rafId);
      last = performance.now();
      rafId = requestAnimationFrame(draw);
    };
    const stop = () => cancelAnimationFrame(rafId);

    const onResize = () => {
      resize();
      seed();
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!reduced) start();
    };
    const onThemeChange = () => {
      const next = readTheme();
      if (next === theme) return;
      theme = next;
      palette = theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
      sprites = palette.map((c) => buildSprite(c, 72));
      canvas.style.mixBlendMode = theme === 'light' ? 'multiply' : 'screen';
      for (const lf of leaves) {
        lf.colorIdx = Math.floor(Math.random() * palette.length);
      }
    };

    const obs = new MutationObserver(onThemeChange);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    if (reduced) {
      draw(performance.now());
    } else {
      start();
    }

    return () => {
      stop();
      obs.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [density, intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 1 }}
    />
  );
}

export default FallingLeaves;
