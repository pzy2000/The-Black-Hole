// 理论验证：镜像 src/ship.ts integrateShip + src/main.ts updateHeat 的 1:1 数值仿真
// 单位: Rs=1, c=1, GM=0.5 (Paczyński–Wiita)
const GM = 0.5;
const H = 0.02;          // integrateShip 子步长
const VCAP = 0.95;       // 速度硬上限
const CRASH_R = 1.05;    // 坠洞判据

interface Result {
  name: string;
  death: 'horizon' | 'overheat' | 'survived-full' | 'none';
  peakHeat: number;      // 全程热量峰值
  heatAtHorizon: number; // 越界瞬间热量
  tToEnd: number;        // 到终点(坠洞/解体/截断)的模拟秒
  vAtHorizon: number;
  minR: number;
}

function simulate(
  name: string,
  pos0: [number, number, number],
  vel0: [number, number, number],
  companion = false,       // 天鹅座 X-1 才有伴星辐照项
  frameDt = 0.05,          // 每帧 dtSim（游戏 20–60fps 影响甚微）
  maxT = 4000,
): Result {
  let [x, y, z] = pos0;
  let [vx, vy, vz] = vel0;
  let heat = 0, t = 0;
  let death: Result['death'] = 'none';
  let peakHeat = 0, heatAtHorizon = -1, vAtHorizon = -1, minR = Infinity;
  let tToEnd = 0;

  while (t < maxT) {
    // —— integrateShip：半隐式欧拉子步 ——
    let crashed = false;
    let remain = frameDt;
    while (remain > 1e-6 && !crashed) {
      const step = Math.min(H, remain);
      remain -= step;
      let px = x, py = y, pz = z;
      const r = Math.hypot(px, py, pz);
      const k = -GM / Math.pow(Math.max(r - 1, 0.05), 2) / r;
      vx += px * k * step; vy += py * k * step; vz += pz * k * step;
      x += vx * step; y += vy * step; z += vz * step;
      const r2 = Math.hypot(x, y, z);
      if (r2 < CRASH_R) crashed = true;
    }
    const spd = Math.hypot(vx, vy, vz);
    if (spd > VCAP) { const s = VCAP / spd; vx *= s; vy *= s; vz *= s; }
    t += frameDt;

    // —— updateHeat（1:1 抄 main.ts，Sgr A* 无伴星则跳过 120/d²）——
    const r = Math.hypot(x, y, z);
    const ay = Math.abs(y);
    let rate = 90 / (r * r);
    if (companion) {
      // 伴星轨道半径 70，最坏情况取 d=65（略保守）
      rate += 120 / (65 * 65);
    }
    if (r < 14 && r > 2.8 && ay < 2.5) rate += (450 / (r * r)) * (1 - ay / 2.5);
    rate -= 1.4;
    heat = Math.min(130, Math.max(0, heat + rate * frameDt));
    peakHeat = Math.max(peakHeat, heat);
    minR = Math.min(minR, r);

    if (crashed) {
      death = 'horizon';
      heatAtHorizon = heat; vAtHorizon = Math.hypot(vx, vy, vz); tToEnd = t;
      break;
    }
    if (heat >= 100) { death = 'overheat'; tToEnd = t; break; }
  }
  if (death === 'none') death = t >= maxT ? 'survived-full' : 'none';
  return { name, death, peakHeat, heatAtHorizon, tToEnd, vAtHorizon, minR };
}

function circ(r: number) { return Math.sqrt((GM * r) / (r - 1) ** 2); }

const rows: Result[] = [];
const deg = Math.PI / 180;

// 1. 贴盘面径向坠落（赤道面内，静止释放）
rows.push(simulate('A 赤道面内径向坠落(静止,r=14)', [14, 0, 0], [0, 0, 0]));
// 2. 极区径向坠落（静止释放）——最慢的极区下落
rows.push(simulate('B 极区径向坠落(静止,r=14)', [0, 14, 0], [0, 0, 0]));
// 3. 极区高速俯冲（0.9c 直冲）
rows.push(simulate('C 极区俯冲(初速0.9c,r=14)', [0, 14, 0], [0, -0.9, 0]));
// 4. 赤道面内高速俯冲
rows.push(simulate('D 赤道面内俯冲(初速0.9c,r=14)', [14, 0, 0], [-0.9, 0, 0]));
// 5. 游戏开局状态直接甩进去（初始圆轨道 r=14, y=1.2，逆推消除切向后自然坠落）
{
  const r = 14, vc = circ(r);
  // 保留切向速度的圆轨道不会坠落——改为"刹车失效"最坏情形：完整圆轨道维持（对照组）
  rows.push(simulate('E 开局圆轨道维持(对照组)', [14, 1.2, 0], [0, 0, vc], false, 0.05, 3000));
}
// 6–10. 斜角俯冲扫描：与极轴夹角 θ，静止释放，找临界角
for (const th of [30, 45, 60, 70, 80, 87]) {
  const c = Math.cos(th * deg), s = Math.sin(th * deg);
  rows.push(simulate(`F 斜角${th}°俯冲(静止,r=14)`, [14 * s, 14 * c, 0], [0, 0, 0]));
}
// 11. 天鹅座 X-1（带伴星辐照）极区坠落
rows.push(simulate('G 极区坠落+伴星辐照(CygX1,静止,r=14)', [0, 14, 0], [0, 0, 0], true));

console.log(
  '场景'.padEnd(34),
  '结局'.padEnd(10),
  '峰值热'.padStart(7),
  '越界热'.padStart(7),
  '历时s'.padStart(7),
  '越界速度'.padStart(8),
);
for (const r of rows) {
  console.log(
    r.name.padEnd(34),
    r.death.padEnd(10),
    r.peakHeat.toFixed(1).padStart(7),
    (r.heatAtHorizon < 0 ? '-' : r.heatAtHorizon.toFixed(1)).padStart(7),
    r.tToEnd.toFixed(1).padStart(7),
    (r.vAtHorizon < 0 ? '-' : r.vAtHorizon.toFixed(3)).padStart(8),
  );
}

// 临界角细扫：峰值热量恰为 100 的释放角
console.log('\n临界角细扫（静止释放，θ 为与极轴夹角）:');
for (let th = 74; th <= 90; th += 2) {
  const c = Math.cos(th * deg), s = Math.sin(th * deg);
  const res = simulate(`θ=${th}°`, [14 * s, 14 * c, 0], [0, 0, 0]);
  console.log(
    `θ=${th}°`.padEnd(9),
    res.death.padEnd(10),
    `peak=${res.peakHeat.toFixed(1)}`,
  );
}

// —— 临界角二分 + 更远释放半径检验 ——
console.log('\n临界角二分（静止释放, 与极轴夹角）:');
{
  let lo = 45, hi = 60;
  const heatAt = (th: number) => {
    const c = Math.cos(th * deg), s = Math.sin(th * deg);
    return simulate('x', [14 * s, 14 * c, 0], [0, 0, 0]);
  };
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (heatAt(mid).death === 'overheat') hi = mid; else lo = mid;
  }
  console.log(`临界角 ≈ ${(lo + hi) / 2}°  (≤${lo.toFixed(1)}° 存活触界, ≥${hi.toFixed(1)}° 过热解体)`);
}
for (const r0 of [20, 25]) {
  const res = simulate(`极区坠落(静止,r=${r0})`, [0, r0, 0], [0, 0, 0]);
  console.log(`r0=${r0}: ${res.death}, 峰值热=${res.peakHeat.toFixed(1)}, 历时=${res.tToEnd.toFixed(1)}s`);
}
// 玩家最可能路径：先降到盘边冷却再极区俯冲（r=8 处静止释放）
{
  const res = simulate('极区坠落(静止,r=8)', [0, 8, 0], [0, 0, 0]);
  console.log(`r0=8: ${res.death}, 峰值热=${res.peakHeat.toFixed(1)}, 历时=${res.tToEnd.toFixed(1)}s`);
}
