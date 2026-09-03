// HYG 星表 → 运行时星空数据
// 输出:
//   public/sky/stars.bin   Float32 × 5/星: dirX, dirY, dirZ, intensity, tempNorm
//   public/sky/named.json  亮星与星座成员（名字/星等/方向/色温），供星图模式使用
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, 'assets/hyg.csv'), 'utf8');

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = csv.split('\n');
const header = parseCSVLine(lines[0].replace(/\r$/, ''));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const f = (row, key) => {
  const v = row[col[key]];
  return v === undefined || v === '' ? NaN : parseFloat(v);
};
const s = (row, key) => (row[col[key]] ?? '').trim();

// B−V 色指数 → 开尔文（Ballesteros 公式）
function bvToKelvin(bv) {
  const b = Math.min(2.0, Math.max(-0.33, bv));
  return 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
}
const TEMP_MIN = 2500, TEMP_MAX = 30000;
const normTemp = (k) => Math.min(1, Math.max(0, (k - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)));

const D2R = Math.PI / 180;
const data = [];
const named = [];
let count = 0;

for (let li = 1; li < lines.length; li++) {
  const line = lines[li].replace(/\r$/, '');
  if (!line) continue;
  const row = parseCSVLine(line);
  const mag = f(row, 'mag');
  const ra = f(row, 'ra');
  const dec = f(row, 'dec');
  if (!isFinite(mag) || !isFinite(ra) || !isFinite(dec)) continue;
  if (mag > 9.5) continue;

  const cd = Math.cos(dec * D2R);
  const dx = cd * Math.cos(ra * D2R);
  const dy = Math.sin(dec * D2R);
  const dz = cd * Math.sin(ra * D2R);

  // 视星等 → HDR 强度（6 等为肉眼极限 = 1）
  let intensity = Math.pow(10, -0.4 * (mag - 6.0));
  intensity = Math.min(250, Math.max(0.008, intensity));

  const ci = f(row, 'ci');
  const temp = isFinite(ci) ? bvToKelvin(ci) : 6500;

  data.push(dx, dy, dz, intensity, normTemp(temp));
  count++;

  const proper = s(row, 'proper');
  if (proper && mag <= 3.6) {
    named.push({
      name: proper,
      mag: +mag.toFixed(2),
      dir: [+dx.toFixed(5), +dy.toFixed(5), +dz.toFixed(5)],
      temp: Math.round(temp),
    });
  }
}

mkdirSync(join(root, 'public/sky'), { recursive: true });
const buf = new Float32Array(data);
writeFileSync(join(root, 'public/sky/stars.bin'), buf);
writeFileSync(join(root, 'public/sky/named.json'), JSON.stringify(named));
console.log(`烘焙完成: ${count} 颗星 → stars.bin (${(buf.length * 4 / 1e6).toFixed(1)} MB), 命名亮星 ${named.length} 颗`);
