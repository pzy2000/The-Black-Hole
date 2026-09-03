import * as THREE from 'three';
import { circularSpeed, FUEL_MAX, type GameState, type ShipState } from './state';

export interface MissionWaypoint {
  pos: [number, number, number];
  label: string;
  radius: number;
  color?: number;
}

export interface MissionFx {
  flash(): void;
  spawnProbe(from: { x: number; y: number; z: number }): void;
  dockDerelict(): boolean;
}
export interface MissionCtx {
  ship: ShipState;
  state: GameState;
  flags: Set<string>;
  toast(msg: string): void;
  lookAlong(x: number, y: number, z: number): void;
  fx: MissionFx;
  /** 伴星实时位置（无伴星系统返回 null） */
  companionPos(): THREE.Vector3 | null;
  nearCompanion(dist: number): boolean;
}

export interface Mission {
  title: string;
  brief: string[];
  complete: string[];
  waypoints?: MissionWaypoint[];
  setup: (ctx: MissionCtx) => void;
  objectives: { text: string; check: (ctx: MissionCtx) => boolean }[];
  onKey?: (code: string, ctx: MissionCtx) => void;
  /** 需要主程序特殊处理的关卡：救援 NPC / 终章双结局 */
  special?: 'derelict' | 'finale';
}

function circularOrbit(r: number, inclination = 0): { pos: [number, number, number]; vel: [number, number, number] } {
  const pos = new THREE.Vector3(r * Math.cos(inclination), r * Math.sin(inclination), 0);
  const tangent = new THREE.Vector3(-pos.z, 0, pos.x).normalize();
  const v = circularSpeed(pos.length());
  return {
    pos: [pos.x, pos.y, pos.z],
    vel: [tangent.x * v, tangent.y * v, tangent.z * v],
  };
}

export const MISSIONS: Mission[] = [
  {
    title: '第一关 · 远轨适应',
    brief: [
      '欢迎登上深空科考船「视界号」。',
      '你正处在一个 430 万倍太阳质量黑洞的安全轨道上。',
      '先熟悉飞船：这里的引力、时间，都不再是地球的规则。',
    ],
    complete: [
      '基础操控训练完成。',
      '提示：越靠近黑洞，你的时间越慢——留意 HUD 上的双时钟分叉。',
    ],
    setup: (ctx) => {
      const o = circularOrbit(18, 0.06);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '主引擎加速至 0.25c 以上（按住 W）', check: (c) => c.ship.vel.length() >= 0.25 },
      { text: '使用时间加速（按 Z）', check: (c) => c.flags.has('warp') },
      { text: '抵近黑洞：进入 8 Rs 以内', check: (c) => c.ship.pos.length() < 8 },
      { text: '安全减速至 0.06c 以下（X 自动刹车）', check: (c) => c.ship.vel.length() < 0.06 },
    ],
  },
  {
    title: '第二关 · 光子环摄影',
    brief: [
      '摄影组要在光子球（1.5 Rs）附近拍下黑洞的剪影。',
      'ISCO（最内稳定轨道）在 3 Rs——越过它，稳定圆轨道就不复存在。',
      '深入 3.5 Rs 以内，释放探测器，然后活着回来。',
    ],
    complete: [
      '照片已传回地球。阴影边缘那一圈细细的光，是绕行黑洞后才抵达相机的光子——',
      '它们在视界旁转了半圈甚至数圈。人类从未见过这样的照片。',
    ],
    setup: (ctx) => {
      const o = circularOrbit(12, -0.04);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '深入险境：进入 3.5 Rs 以内', check: (c) => c.ship.pos.length() < 3.5 },
      { text: '释放摄影探测器（3.5 Rs 以内按 T）', check: (c) => c.flags.has('photo') },
      { text: '全身而退：撤离到 10 Rs 以外', check: (c) => c.ship.pos.length() > 10 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.ship.pos.length() < 3.5 && !ctx.flags.has('photo')) {
        ctx.flags.add('photo');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('探测器已释放 — 曝光中…');
      }
    },
  },
  {
    title: '第三关 · 盘缘采样',
    brief: [
      '吸积盘外缘的温度相对温和，但辐射足以炙烤船体。',
      '前往盘缘采样点完成采集——盯着船温，超过 100% 船体解体。',
      '采集完成后立即撤离冷却。热，是这个关卡唯一的敌人。',
    ],
    complete: ['样本已封存。', '接下来，是真正的深处。'],
    waypoints: [{ pos: [12.2, 0.55, 0], label: '盘缘采样点', radius: 1.6 }],
    setup: (ctx) => {
      const o = circularOrbit(17, 0.05);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '抵达盘内缘采样点（留意船温）', check: (c) => c.flags.has('wp0') },
      { text: '撤离到 17 Rs 以外', check: (c) => c.ship.pos.length() > 17 },
      { text: '冷却：船温降到 40% 以下', check: (c) => c.ship.heat < 40 },
    ],
  },
  {
    title: '第四关 · 引力救援',
    brief: [
      '一艘自动化货船的引力弹弓计算出错，正沿坠落轨道冲向视界。',
      '追上它，完成对接，带着冬眠舱里的一千名船员撤离。',
      '它不会等你——时间在它那边流得更快。',
    ],
    complete: ['一千名冬眠者安全转移。', '他们醒来时会发现自己离宇宙最深处的谜，只差最后一次坠落。'],
    setup: (ctx) => {
      const o = circularOrbit(16, -0.05);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '接近失控货船至 1.2 Rs 以内', check: (c) => c.flags.has('near') },
      { text: '按 T 完成对接（1.2 Rs 以内）', check: (c) => c.flags.has('dock') },
      { text: '带着船员撤离至 15 Rs 以外', check: (c) => c.ship.pos.length() > 15 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.flags.has('near') && !ctx.flags.has('dock')) {
        if (ctx.fx.dockDerelict()) {
          ctx.flags.add('dock');
          ctx.fx.flash();
          ctx.toast('对接完成 — 一千名冬眠者数据同步中…');
        }
      }
    },
    special: 'derelict',
  },
  {
    title: '第五关 · 深入 ISCO',
    brief: [
      'ISCO——最内稳定圆轨道，3 Rs。在它以内，不存在"安全地待着"这回事。',
      '投放一枚自毁式探测器，收回它坠毁前的最后一组数据。',
      '记住：进去靠的是速度，出来靠的也是速度。',
    ],
    complete: ['数据完整回收。', '在 3 Rs 以内，你亲自验证了：连"原地悬停"都是时空不允许的奢望。'],
    setup: (ctx) => {
      const o = circularOrbit(13, 0.03);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '越过稳定之墙：进入 2.8 Rs 以内', check: (c) => c.ship.pos.length() < 2.8 },
      { text: '投放探测器（3 Rs 以内按 T）', check: (c) => c.flags.has('probe') },
      { text: '返回 8 Rs 以外', check: (c) => c.ship.pos.length() > 8 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.ship.pos.length() < 3 && !ctx.flags.has('probe')) {
        ctx.flags.add('probe');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('探测器已投放 — 数据回流中…');
      }
    },
  },
  {
    title: '第六关 · 红移测绘',
    brief: [
      '科学部分想在三个深度校准时钟，绘制引力时间膨胀曲线。',
      '依次抵达三个测绘点，让船载原子钟记录每一处的流速。',
      '每一站，地球那边的钟都会走得更慢一些——反过来说，更快一些。',
    ],
    complete: [
      '三个深度的时钟读数连成一条曲线，与 1915 年那组方程的预言分毫不差。',
      '爱因斯坦从未见过黑洞，但他早就写下了它的一切。',
    ],
    waypoints: [
      { pos: [10, 1.2, 0], label: '测绘点 α', radius: 1.4 },
      { pos: [0, 1.2, 6.5], label: '测绘点 β', radius: 1.4 },
      { pos: [-4.5, 1.2, 0], label: '测绘点 γ', radius: 1.4 },
    ],
    setup: (ctx) => {
      const o = circularOrbit(14, 0.04);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '抵达测绘点 α（10 Rs）', check: (c) => c.flags.has('wp0') },
      { text: '抵达测绘点 β（6.5 Rs）', check: (c) => c.flags.has('wp1') },
      { text: '抵达测绘点 γ（4.5 Rs）', check: (c) => c.flags.has('wp2') },
      { text: '返回 12 Rs 以外', check: (c) => c.ship.pos.length() > 12 },
    ],
  },
  {
    title: '第七关 · 高温区',
    brief: [
      '盘内缘的物质以一半光速运转，温度足以让任何计算机器液化。',
      '你要抵达内缘采样点，取回"最热的数据"。',
      '这一关没有敌人，只有热力学。它从不谈判。',
    ],
    complete: ['样本封存。这是人类触到过的、离视界最近的物质。'],
    waypoints: [{ pos: [4.2, 0.35, 0], label: '内缘采样点', radius: 1.4, color: 0xff8a5c }],
    setup: (ctx) => {
      const o = circularOrbit(13, 0.02);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '抵达内缘采样点（热量暴涨！）', check: (c) => c.flags.has('wp0') },
      { text: '立刻撤离至 12 Rs 以外', check: (c) => c.ship.pos.length() > 12 },
      { text: '冷却：船温降到 30% 以下', check: (c) => c.ship.heat < 30 },
    ],
  },
  {
    title: '终章 · 视界线',
    brief: [
      '地球总部发来最后一条命令：获取视界内侧的数据。',
      '所有的轨道力学、所有的方程、所有的直觉都说：不可能。',
      '命令的最后写着——"你可以选择"。现在，轮到你决定了。',
    ],
    complete: [
      '结局 A · 折返的人',
      '你带着数据回到了人类的世界。此后余生，每当闭上眼睛，',
      '你都会看见那道纤细的光环——以及它背后那个你没有跨过的圆。',
    ],
    setup: (ctx) => {
      const o = circularOrbit(16, 0);
      ctx.ship.pos.set(o.pos[0], o.pos[1], o.pos[2]);
      ctx.ship.vel.set(o.vel[0], o.vel[1], o.vel[2]);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(o.vel[0], o.vel[1], o.vel[2]);
    },
    objectives: [
      { text: '走上终末航线：进入 3 Rs 以内', check: (c) => c.ship.pos.length() < 3 },
      { text: '深入到 2.6 Rs 以内，等待抉择……', check: (c) => c.flags.has('chosen') },
      { text: '逃逸至 12 Rs 以外', check: (c) => c.ship.pos.length() > 12 },
    ],
    special: 'finale',
  },
  {
    title: '巡礼 · 遇见天鹅座 X-1',
    brief: [
      '曲率跳跃完成。7200 光年外，人类确认的第一个黑洞出现在舷窗外。',
      '它正从伴星——蓝超巨星 HDE 226868 身上撕下物质。那颗星比太阳大几十倍，表面温度是太阳的四倍。',
      '抵近它，采集星风数据。记住：这颗星的辐射，和它的体量一样不讲道理。',
    ],
    complete: [
      '星风数据完整。这颗蓝超巨星每百万年就被邻居吃掉一个太阳的质量。',
      '霍金当年赌它不是黑洞，输了。现在你亲眼确认了。',
    ],
    setup: (ctx) => {
      ctx.ship.pos.set(45, 4, 20);
      const tangent = new THREE.Vector3(-ctx.ship.pos.z, 0, ctx.ship.pos.x).normalize();
      ctx.ship.vel.copy(tangent.multiplyScalar(Math.sqrt(0.5 * ctx.ship.pos.length() / (ctx.ship.pos.length() - 1) ** 2)));
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(tangent.x, tangent.y, tangent.z);
    },
    objectives: [
      { text: '抵近伴星 HDE 226868 至 18 Rs 以内', check: (c) => c.nearCompanion(18) },
      { text: '按 T 采集星风数据（18 Rs 以内）', check: (c) => c.flags.has('wind') },
      { text: '撤离至黑洞 30 Rs 以外', check: (c) => c.ship.pos.length() > 30 },
    ],
    onKey: (code, ctx) => {
      const cp = ctx.companionPos();
      if (code === 'KeyT' && cp && !ctx.flags.has('wind')) {
        const d = ctx.ship.pos.distanceTo(new THREE.Vector3(cp.x, cp.y, cp.z));
        if (d < 18) {
          ctx.flags.add('wind');
          ctx.fx.flash();
          ctx.toast('星风数据已存档');
        }
      }
    },
  },
  {
    title: '巡礼 · 洛希瓣之河',
    brief: [
      '从蓝超巨星流向黑洞的物质流，就是一座悬在太空中的河流。',
      '沿着它飞行，在河流中段采集一份"正在落向永恒"的物质样本。',
      '河流的尽头是吸积盘——那里的温度足以照亮整个星系的这一角。',
    ],
    complete: ['样本封存：物质流中的温度、密度与速度剖面完整回收。', '这是人类第一次从河流内部观察一条物质之河。'],
    waypoints: [{ pos: [38, 1.5, 0], label: '物质流采样点', radius: 6, color: 0x9fc8ff }],
    setup: (ctx) => {
      ctx.ship.pos.set(55, 3, 14);
      const tangent = new THREE.Vector3(-ctx.ship.pos.z, 0, ctx.ship.pos.x).normalize();
      ctx.ship.vel.copy(tangent.multiplyScalar(Math.sqrt(0.5 * ctx.ship.pos.length() / (ctx.ship.pos.length() - 1) ** 2)));
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(tangent.x, tangent.y, tangent.z);
    },
    objectives: [
      { text: '抵达物质流采样点', check: (c) => c.flags.has('wp0') },
      { text: '按 T 采集河流样本（采样点附近）', check: (c) => c.flags.has('stream') },
      { text: '顺流而下：抵达黑洞 8 Rs 以内', check: (c) => c.ship.pos.length() < 8 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.flags.has('wp0') && !ctx.flags.has('stream')) {
        ctx.flags.add('stream');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('河流样本已采集');
      }
    },
  },
  {
    title: '巡礼 · X 射线之眼',
    brief: [
      '天鹅座 X-1 之所以被发现，是因为它极强的 X 射线辐射。',
      '把 X 射线探测器送进 6 Rs 以内的强辐射区，"看"一眼这头怪兽的正脸。',
      '它的盘比人马座 A* 的热得多——船温管理将是真正的考验。',
    ],
    complete: ['X 射线能谱数据完整回收。', '人类的第一颗 X 射线卫星就是因为发现它而得名的——现在，你替它再飞了一次。'],
    setup: (ctx) => {
      ctx.ship.pos.set(14, 1.5, 0);
      const tangent = new THREE.Vector3(-ctx.ship.pos.z, 0, ctx.ship.pos.x).normalize();
      ctx.ship.vel.copy(tangent.multiplyScalar(Math.sqrt(0.5 * ctx.ship.pos.length() / (ctx.ship.pos.length() - 1) ** 2)));
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(tangent.x, tangent.y, tangent.z);
    },
    objectives: [
      { text: '深入强辐射区：进入 6 Rs 以内', check: (c) => c.ship.pos.length() < 6 },
      { text: '释放 X 射线探测器（6 Rs 以内按 T）', check: (c) => c.flags.has('xray') },
      { text: '全身而退：撤离至 30 Rs 以外', check: (c) => c.ship.pos.length() > 30 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.ship.pos.length() < 6 && !ctx.flags.has('xray')) {
        ctx.flags.add('xray');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('X 射线探测器已释放');
      }
    },
  },
  {
    title: '巡礼 · 遇见 M87*',
    brief: [
      '最后一跳：5500 万光年，室女座星系团的心脏。',
      '这个黑洞的质量是太阳的 65 亿倍——它的一根喷流，就能横贯你的整个母星系。',
      '先做一次远程勘察：确认喷流的进动轴，然后贴着它飞完全程。',
    ],
    complete: ['勘察完成。喷流正以 0.9 倍光速外流，规律性结节如时钟般精确。', '2019 年人类给它拍过一张照片——你马上就能站到比那张照片近一万亿倍的地方。'],
    setup: (ctx) => {
      ctx.ship.pos.set(50, 6, 30);
      const tangent = new THREE.Vector3(-ctx.ship.pos.z, 0, ctx.ship.pos.x).normalize();
      ctx.ship.vel.copy(tangent.multiplyScalar(Math.sqrt(0.5 * ctx.ship.pos.length() / (ctx.ship.pos.length() - 1) ** 2)));
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(tangent.x, tangent.y, tangent.z);
    },
    objectives: [
      { text: '沿喷流向上游飞至 45 Rs 高度', check: (c) => c.ship.pos.y > 45 },
      { text: '穿越到下游 45 Rs（-y 方向）', check: (c) => c.ship.pos.y < -45 },
      { text: '返回盘平面附近（|y| < 8）', check: (c) => Math.abs(c.ship.pos.y) < 8 },
    ],
  },
  {
    title: '巡礼 · 甜甜圈时刻',
    brief: [
      '1918 年，Heber Curtis 在 M87 星系里第一次注意到这根「奇特的直线」。',
      '2019 年，事件视界望远镜把它的影子拍成了人类的第一张黑洞照片。',
      '现在，把飞船开到「地球等效视角」，用船载相机复现那一刻。按 E 进入。',
    ],
    complete: [
      '照片已存档。阴影的直径约 420 亿公里，比整个太阳系还大。',
      'EHT 团队花了十年才洗出这张照片；你只用了一次跳跃。',
    ],
    setup: (ctx) => {
      ctx.ship.pos.set(1500, 90, 0);
      ctx.ship.vel.set(0, 0, 0);
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(-1500, -90, 0);
    },
    objectives: [
      { text: '按 E 进入 EHT 视角并拍摄（任意距离）', check: (c) => c.flags.has('eht') },
      { text: '抵近：回到 200 Rs 以内', check: (c) => c.ship.pos.length() < 200 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyE' && !ctx.flags.has('eht')) {
        ctx.flags.add('eht');
        ctx.fx.flash();
        ctx.toast('EHT 视角照片已存档');
      }
    },
  },
  {
    title: '巡礼 · 巨兽之眼',
    brief: [
      '巡礼的最后一站：贴近 M87* 的光子环。',
      '65 亿倍太阳质量的时空在这里弯曲得恰到好处，光可以绕它转上一整圈。',
      '进去，拍下它的正脸，回来。和第一站一样的任务——但这一次，你是替 5500 万年后的地球去的。',
    ],
    complete: [
      '三站巡礼，就此完成。',
      '从人马座 A* 的金色巨盘，到天鹅座 X-1 的物质之河，再到这里的万丈喷流——',
      '每一个黑洞都是同一组方程的解，却各有各的性格。地球会为你的数据骄傲很多代。',
    ],
    setup: (ctx) => {
      ctx.ship.pos.set(20, 2, 0);
      const tangent = new THREE.Vector3(0, 0, 1);
      ctx.ship.vel.copy(tangent.multiplyScalar(Math.sqrt(0.5 * ctx.ship.pos.length() / (ctx.ship.pos.length() - 1) ** 2)));
      ctx.ship.fuel = FUEL_MAX;
      ctx.ship.heat = 0;
      ctx.ship.alive = true;
      ctx.lookAlong(tangent.x, tangent.y, tangent.z);
    },
    objectives: [
      { text: '深入至 4 Rs 以内', check: (c) => c.ship.pos.length() < 4 },
      { text: '拍摄光子环正脸（4 Rs 以内按 T）', check: (c) => c.flags.has('ring') },
      { text: '返航：撤离至 40 Rs 以外', check: (c) => c.ship.pos.length() > 40 },
    ],
    onKey: (code, ctx) => {
      if (code === 'KeyT' && ctx.ship.pos.length() < 4 && !ctx.flags.has('ring')) {
        ctx.flags.add('ring');
        ctx.fx.spawnProbe(ctx.ship.pos);
        ctx.fx.flash();
        ctx.toast('光子环影像已存档');
      }
    },
  },
];
