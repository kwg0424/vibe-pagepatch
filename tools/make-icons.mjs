#!/usr/bin/env node
// 아이콘 PNG 만들기 (외부 패키지 없이): 파란 둥근 사각형 + 흰 대각선 반창고(패치) + 노란 패드.
// TapCode · DragOn · StayTab · EdgeMark 와 같은 모양: 꽉 찬 #2563EB 사각형(모서리 22%), 흰 평면 도형, 노랑(#FACC15) 포인트 하나.
//   node tools/make-icons.mjs   → icons/icon-{16,32,48,128}.png
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");

// 둥근 사각형 안인지 (중심 기준 좌표)
function inRoundRect(x, y, hw, hh, r) {
  const dx = Math.max(Math.abs(x) - (hw - r), 0);
  const dy = Math.max(Math.abs(y) - (hh - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function pixel(u, v) {
  // u, v: 0..1
  const x = u - 0.5;
  const y = 0.5 - v; // 위아래 뒤집음: 반창고가 왼쪽 아래 → 오른쪽 위
  const BLUE = [37, 99, 235];
  if (!inRoundRect(x, y, 0.5, 0.5, 0.225)) return null;
  let c = BLUE;
  // 반창고: -45도 회전한 둥근 막대 (흰색)
  const a = Math.PI / 4;
  const rx = x * Math.cos(a) + y * Math.sin(a);
  const ry = -x * Math.sin(a) + y * Math.cos(a);
  if (inRoundRect(rx, ry, 0.38, 0.135, 0.135)) {
    c = [255, 255, 255];
    // 가운데 패드 (노랑)
    if (inRoundRect(rx, ry, 0.115, 0.135, 0.015)) c = [250, 204, 21];
  }
  return c;
}

function render(size) {
  const SS = 4; // 4×4 샘플로 가장자리 부드럽게
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = pixel((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      const o = 1 + px * 4;
      if (n) {
        row[o] = Math.round(r / n);
        row[o + 1] = Math.round(g / n);
        row[o + 2] = Math.round(b / n);
        row[o + 3] = Math.round((255 * n) / (SS * SS));
      }
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(OUT, `icon-${s}.png`), render(s));
console.log(`icons → ${OUT}`);
