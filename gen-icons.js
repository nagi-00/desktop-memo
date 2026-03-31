/**
 * gen-icons.js — 연결된 클로버 + 이중 흰 십자 (+ 와 ×) 아이콘 생성
 * node gen-icons.js
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

/**
 * buildTrayIcon() 과 동일한 디자인을 임의 크기로 렌더링
 */
function makeCloverPNG(W, H, color = '#8fbc8f', withBackground = true) {
  let hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) hex = '8fbc8f';
  const fr = parseInt(hex.slice(0, 2), 16);
  const fg = parseInt(hex.slice(2, 4), 16);
  const fb = parseInt(hex.slice(4, 6), 16);

  const buf = Buffer.alloc(W * H * 4, 0);

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const sA = a / 255, dA = buf[i + 3] / 255;
    const oA = sA + dA * (1 - sA);
    if (oA === 0) { buf[i] = buf[i+1] = buf[i+2] = buf[i+3] = 0; return; }
    buf[i]   = Math.round((r * sA + buf[i]   * dA * (1 - sA)) / oA);
    buf[i+1] = Math.round((g * sA + buf[i+1] * dA * (1 - sA)) / oA);
    buf[i+2] = Math.round((b * sA + buf[i+2] * dA * (1 - sA)) / oA);
    buf[i+3] = Math.round(oA * 255);
  }
  function fillCircle(cx, cy, r, R, G, B, A) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= r - 0.5) setPixel(x, y, R, G, B, A);
        else if (d <= r + 0.5) setPixel(x, y, R, G, B, Math.round(A * (r + 0.5 - d)));
      }
    }
  }
  function drawLine(x1, y1, x2, y2, thick, R, G, B, A) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fillCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thick / 2, R, G, B, A);
    }
  }
  function fillRoundRect(x, y, w, h, rad, R, G, B, A) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const nearX = Math.max(x + rad, Math.min(x + w - rad, px));
        const nearY = Math.max(y + rad, Math.min(y + h - rad, py));
        const d = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
        if (d <= rad - 0.5) setPixel(px, py, R, G, B, A);
        else if (d <= rad + 0.5) setPixel(px, py, R, G, B, Math.round(A * (rad + 0.5 - d)));
      }
    }
  }

  // 배경 (흰 둥근 사각형)
  if (withBackground) {
    fillRoundRect(0, 0, W, H, W * 0.2, 255, 255, 255, 255);
  }

  // 연결된 클로버 + 이중 십자 (buildTrayIcon 과 동일 비율)
  const leafR  = W * 0.27, offset = W * 0.175;
  const leafCY = H * 0.44;
  const leaves = [
    { x: W/2 - offset, y: leafCY - offset },
    { x: W/2 + offset, y: leafCY - offset },
    { x: W/2 - offset, y: leafCY + offset },
    { x: W/2 + offset, y: leafCY + offset },
  ];
  const sw = Math.max(2, leafR * 0.18);

  // 흰 외곽선 + 줄기 (배경레이어)
  for (const { x, y } of leaves) fillCircle(x, y, leafR + sw / 2, 255, 255, 255, 255);
  const stemW  = Math.max(1.5, W * 0.07);
  const stemX1 = W/2 - W * 0.01, stemY1 = leafCY + offset + leafR * 0.6;
  const stemX2 = W/2 - W * 0.18, stemY2 = H - H * 0.08;
  drawLine(stemX1, stemY1, stemX2, stemY2, stemW + sw, 255, 255, 255, 255);

  // 잎 채우기
  for (const { x, y } of leaves) fillCircle(x, y, leafR, fr, fg, fb, 255);

  // + 십자만
  const cw = Math.max(1, W * 0.04);
  drawLine(W/2, leafCY - leafR, W/2, leafCY + leafR, cw, 255, 255, 255, 200);
  drawLine(W/2 - leafR, leafCY, W/2 + leafR, leafCY, cw, 255, 255, 255, 200);

  // 줄기 색상
  drawLine(stemX1, stemY1, stemX2, stemY2, stemW, fr, fg, fb, 255);

  // PNG 인코딩
  function crc32(b) {
    let crc = 0xffffffff;
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
    for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const tb = Buffer.from(type, 'ascii'), body = Buffer.concat([tb, data]);
    const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
    const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(body));
    return Buffer.concat([lb, body, cb]);
  }
  const rowBytes = W * 4;
  const raw = Buffer.allocUnsafe(H * (1 + rowBytes));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + rowBytes)] = 0;
    buf.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const assetsDir = path.join(__dirname, 'assets');

fs.writeFileSync(path.join(assetsDir, 'icon.png'),     makeCloverPNG(256, 256, '#8fbc8f', true));
console.log('✓ icon.png (256×256)');

fs.writeFileSync(path.join(assetsDir, 'icon-512.png'), makeCloverPNG(512, 512, '#8fbc8f', true));
console.log('✓ icon-512.png (512×512)');

fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), makeCloverPNG(32, 32, '#8fbc8f', false));
console.log('✓ tray-icon.png (32×32)');

console.log('Done!');
