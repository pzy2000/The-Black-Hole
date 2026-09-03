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
];
