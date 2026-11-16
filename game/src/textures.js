// Pasar Senja — every texture is drawn on a canvas at load time. No image
// files, no network: the market's look comes from procedural cloth, wood,
// cobble and paper, in one dusk palette (deep blue night, warm lantern
// amber, faded teal paint, terracotta).

import * as THREE from 'three';

function canvasTexture(width, height, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, width, height, count, colour, alpha) {
  ctx.fillStyle = colour;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i += 1) {
    const size = 1 + Math.random() * 2;
    ctx.fillRect(Math.random() * width, Math.random() * height, size, size);
  }
  ctx.globalAlpha = 1;
}

// Worn cobblestones for the market ground.
export function groundTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3630';
    ctx.fillRect(0, 0, w, h);
    const rows = 8;
    for (let row = 0; row < rows; row += 1) {
      for (let col = -1; col < 9; col += 1) {
        const shade = 52 + Math.floor(Math.random() * 26);
        ctx.fillStyle = `rgb(${shade + 12},${shade + 4},${shade - 6})`;
        const x = col * 64 + (row % 2 === 0 ? 0 : 32);
        const y = row * 64;
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, 58, 58, 10);
        ctx.fill();
      }
    }
    speckle(ctx, w, h, 900, '#000000', 0.25);
    speckle(ctx, w, h, 300, '#f0a830', 0.06);
  }, 10, 10);
}

// Striped awning cloth: alternating bands, slightly faded.
export function awningTexture(colourA, colourB) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    const bands = 8;
    for (let i = 0; i < bands; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? colourA : colourB;
      ctx.fillRect((i * w) / bands, 0, w / bands + 1, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < bands; i += 1) ctx.fillRect((i * w) / bands, 0, 2, h);
    speckle(ctx, w, h, 200, '#000000', 0.12);
  });
}

// Rough planks for crates and stall counters.
export function woodTexture(base = '#7a5a38') {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let plank = 0; plank < 4; plank += 1) {
      const y = plank * 64;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(0, y, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, y + 3, w, 2);
      for (let i = 0; i < 26; i += 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        const gx = Math.random() * w;
        ctx.moveTo(gx, y + 6);
        ctx.bezierCurveTo(gx + 8, y + 22, gx - 8, y + 42, gx + 4, y + 62);
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, 240, '#000000', 0.15);
  });
}

// Painted plaster for the market walls, with a faded lower band.
export function wallTexture(base = '#4d5a66') {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, h - 48, w, 48);
    ctx.fillStyle = 'rgba(240,168,48,0.10)';
    ctx.fillRect(0, h - 52, w, 4);
    speckle(ctx, w, h, 700, '#000000', 0.18);
    speckle(ctx, w, h, 200, '#ffffff', 0.05);
  });
}

// A hanging paper sign with one word on it, e.g. SATE / KOPI / BATIK.
export function signTexture(word, background = '#b3402a') {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f5e6c8';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#f5e6c8';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, w / 2, h / 2 + 2);
  });
}

// A glowing lantern face: warm centre fading to a dark rim.
export function lanternTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const glow = ctx.createRadialGradient(w / 2, h / 2, 6, w / 2, h / 2, 62);
    glow.addColorStop(0, '#fff3c4');
    glow.addColorStop(0.45, '#f0a830');
    glow.addColorStop(1, '#8a4d12');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(60,20,0,0.55)';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  });
}

// Dark corrugated metal for the shipping containers.
export function containerTexture(base = '#33555e') {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, 0, 8, h);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x + 8, 0, 4, h);
    }
    speckle(ctx, w, h, 500, '#7a4a20', 0.22);
    speckle(ctx, w, h, 300, '#000000', 0.18);
  });
}
