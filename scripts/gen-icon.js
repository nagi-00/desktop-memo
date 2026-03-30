/**
 * gen-icon.js — Node.js 순수 PNG 생성 (Canvas/외부 라이브러리 불필요)
 * 실행: node scripts/gen-icon.js
 * 출력: assets/tray-icon.png (32x32), assets/icon.png (256x256)
 */
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── PNG 인코딩 유틸 ──────────────────────────────────────
function writePNG(pixels, width, height, outPath) {
  // pixels: Uint8Array of RGBA (width*height*4)
  // Raw image: filter byte (0x00 = None) + row bytes
  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter=None
    pixels.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function crc32(buf) {
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const body  = Buffer.concat([typeB, data]);
    const len   = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
    const crc   = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  }

  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // color type: RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const out = Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(outPath, out);
  console.log(`✓ ${outPath} (${width}x${height})`);
}

// ── 픽셀 채우기 유틸 ──────────────────────────────────────
function setPixel(buf, width, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= width || y >= buf.length / (width * 4)) return;
  const i = (y * width + x) * 4;
  // alpha compositing over existing
  const srcA = a / 255;
  const dstA = buf[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) { buf[i] = buf[i+1] = buf[i+2] = buf[i+3] = 0; return; }
  buf[i]   = Math.round((r * srcA + buf[i]   * dstA * (1 - srcA)) / outA);
  buf[i+1] = Math.round((g * srcA + buf[i+1] * dstA * (1 - srcA)) / outA);
  buf[i+2] = Math.round((b * srcA + buf[i+2] * dstA * (1 - srcA)) / outA);
  buf[i+3] = Math.round(outA * 255);
}

function fillCircle(buf, width, cx, cy, r, fr, fg, fb, fa) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r - 0.5) {
        setPixel(buf, width, x, y, fr, fg, fb, fa);
      } else if (dist <= r + 0.5) {
        const alpha = Math.round(fa * (r + 0.5 - dist));
        setPixel(buf, width, x, y, fr, fg, fb, alpha);
      }
    }
  }
}

function drawLine(buf, width, x1, y1, x2, y2, thickness, fr, fg, fb, fa) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 3;
  for (let i = 0; i <= steps; i++) {
    const t  = i / steps;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    fillCircle(buf, width, px, py, thickness / 2, fr, fg, fb, fa);
  }
}

// ── 클로버 그리기 함수 ──────────────────────────────────────
function drawClover(buf, width, height, color, strokeColor, scale) {
  const [fr, fg, fb] = color;
  const [sr, sg, sb] = strokeColor;
  const cx = width  / 2;
  const stemEndY = height - height * 0.08;

  // 클로버 4잎 (2x2 배열)의 원 위치
  const leafR   = width  * 0.27 * scale;
  const offset  = width  * 0.175 * scale;
  const leafCY  = height * 0.44;
  const leaves  = [
    { x: cx - offset, y: leafCY - offset }, // 좌상
    { x: cx + offset, y: leafCY - offset }, // 우상
    { x: cx - offset, y: leafCY + offset }, // 좌하
    { x: cx + offset, y: leafCY + offset }, // 우하
  ];

  // 흰색 아웃라인 먼저
  const strokeW = Math.max(2, leafR * 0.18);
  for (const { x, y } of leaves) {
    fillCircle(buf, width, x, y, leafR + strokeW / 2, sr, sg, sb, 255);
  }

  // 줄기 흰색 아웃라인
  const stemW = Math.max(1.5, width * 0.07 * scale);
  const stemX1 = cx - width * 0.01;
  const stemY1 = leafCY + offset + leafR * 0.6;
  const stemX2 = cx - width * 0.18 * scale;
  const stemY2 = stemEndY;
  drawLine(buf, width, stemX1, stemY1, stemX2, stemY2, stemW + strokeW, sr, sg, sb, 255);

  // 잎 채우기
  for (const { x, y } of leaves) {
    fillCircle(buf, width, x, y, leafR, fr, fg, fb, 255);
  }

  // 잎 사이 십자 흰색 선 (분리감 표현)
  const crossW = Math.max(1, width * 0.04 * scale);
  // 수직 중심선
  drawLine(buf, width, cx, leafCY - leafR, cx, leafCY + leafR, crossW, sr, sg, sb, 200);
  // 수평 중심선
  drawLine(buf, width, cx - leafR, leafCY, cx + leafR, leafCY, crossW, sr, sg, sb, 200);

  // 줄기 채우기
  drawLine(buf, width, stemX1, stemY1, stemX2, stemY2, stemW, fr, fg, fb, 255);
}

// ── PNG → ICO (PNG-in-ICO, Windows Vista+) ───────────────
function writeICO(pngBuffers, sizes, outPath) {
  // pngBuffers: Buffer[] (각 사이즈별 PNG 바이트)
  // sizes: number[] (각 PNG의 픽셀 크기)
  const count  = pngBuffers.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;

  const header = Buffer.allocUnsafe(6);
  header.writeUInt16LE(0,     0); // reserved
  header.writeUInt16LE(1,     2); // type: ICO
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (let i = 0; i < count; i++) {
    const sz  = sizes[i];
    const len = pngBuffers[i].length;
    const entry = Buffer.allocUnsafe(16);
    entry[0] = sz >= 256 ? 0 : sz; // width (0 = 256)
    entry[1] = sz >= 256 ? 0 : sz; // height
    entry[2] = 0;  // color count (0 = true color)
    entry[3] = 0;  // reserved
    entry.writeUInt16LE(1,   4); // planes
    entry.writeUInt16LE(32,  6); // bit count
    entry.writeUInt32LE(len, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += len;
  }

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries, ...pngBuffers]));
  console.log(`✓ ${outPath} (ICO: ${sizes.join(', ')}px)`);
}

function makePNG(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  drawClover(buf, size, size, [143, 188, 143], [255, 255, 255], 1.0);
  // PNG를 Buffer로 반환 (파일 저장 없이)
  const rowBytes = size * 4;
  const raw = Buffer.allocUnsafe(size * (1 + rowBytes));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + rowBytes)] = 0;
    buf.copy(raw, y * (1 + rowBytes) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function crc32b(b) {
    let crc = 0xffffffff;
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
    for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const body  = Buffer.concat([typeB, data]);
    const len   = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
    const crc   = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32b(body));
    return Buffer.concat([len, body, crc]);
  }
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

// ── 메인 ────────────────────────────────────────────────
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// 트레이 아이콘: 32x32
{
  const W = 32, H = 32;
  const buf = Buffer.alloc(W * H * 4, 0);
  drawClover(buf, W, H, [143, 188, 143], [255, 255, 255], 1.0);
  writePNG(buf, W, H, path.join(assetsDir, 'tray-icon.png'));
}

// 앱 아이콘: 256x256 (Linux 기본)
{
  const W = 256, H = 256;
  const buf = Buffer.alloc(W * H * 4, 0);
  drawClover(buf, W, H, [143, 188, 143], [255, 255, 255], 1.0);
  writePNG(buf, W, H, path.join(assetsDir, 'icon.png'));
}

// 앱 아이콘: 512x512 (macOS, 고해상도)
{
  const W = 512, H = 512;
  const buf = Buffer.alloc(W * H * 4, 0);
  drawClover(buf, W, H, [143, 188, 143], [255, 255, 255], 1.0);
  writePNG(buf, W, H, path.join(assetsDir, 'icon-512.png'));
}

// Windows ICO: 16, 32, 48, 64, 128, 256 px 멀티 사이즈
{
  const sizes  = [16, 32, 48, 64, 128, 256];
  const bufs   = sizes.map(s => makePNG(s));
  writeICO(bufs, sizes, path.join(assetsDir, 'icon.ico'));
}

console.log('아이콘 생성 완료!');
