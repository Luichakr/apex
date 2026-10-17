// Генерирует простую иконку 1024x1024 PNG (синий фон + белый круг + подпись-блок).
// Запуск: node scripts/make-icon.js <выходной_путь>
const zlib = require("node:zlib");
const fs = require("node:fs");

const SIZE = 1024;
const out = process.argv[2] || "icon.png";

// Цвета
const bg = [79, 140, 255]; // #4f8cff
const fg = [255, 255, 255];

const cx = SIZE / 2,
  cy = SIZE / 2,
  rOuter = 300,
  rInner = 170;

// RGBA буфер + фильтр-байт в начале каждой строки
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - cx, y - cy);
    // кольцо (белое) + белый треугольник "play" внутри
    let col = bg;
    if (d < rOuter && d > rInner) col = fg;
    // простой треугольник play в центре
    const tx = x - cx,
      ty = y - cy;
    if (tx > -70 && tx < 90) {
      const half = (90 - tx) * 0.9;
      if (tx < 90 && ty > -half && ty < half && tx > -70) col = fg;
    }
    raw[p++] = col[0];
    raw[p++] = col[1];
    raw[p++] = col[2];
    raw[p++] = 255;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync(out, png);
console.log(`Иконка сохранена: ${out} (${png.length} байт)`);
