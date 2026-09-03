import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { fullscreenVertex, blackholeFragment, compositeFragment } from './shaders';
import { appendHudStyles, Hud } from './hud';
import { Input } from './input';
import { createShipVisual, integrateShip, OrbitPredictor } from './ship';
import { appendUiStyles, Ui, savedProgress, saveProgress } from './ui';
import { Markers } from './markers';
import { MISSIONS, type MissionCtx, type MissionFx, type MissionWaypoint } from './missions';
import {
  initialShip,
  maxWarpFor,
  WARP_STEPS,
  dilation,
  type GameState,
  type ShipState,
} from './state';

// 开发用：把 shader/运行时报错直接显示在页面上
const errBox = document.createElement('pre');
errBox.style.cssText =
  'position:fixed;bottom:56px;left:12px;max-width:80vw;max-height:45vh;overflow:auto;color:#ff7b6b;font:11px/1.4 monospace;z-index:99;white-space:pre-wrap;pointer-events:none;text-shadow:0 0 4px #000;';
document.body.appendChild(errBox);
const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errBox.textContent += args.map((a) => String(a)).join(' ') + '\n\n';
  origError(...args);
};
window.addEventListener('error', (ev) => {
  errBox.textContent += ev.message + '\n';
});

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('view') as HTMLCanvasElement,
    antialias: false,
    powerPreference: 'high-performance',
  });
} catch (e) {
  document.body.innerHTML = '<p style="padding:2em">此设备不支持 WebGL2，无法运行。</p>';
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const QUALITY = {
  low: { resScale: 0.45, steps: 180 },
  medium: { resScale: 0.62, steps: 300 },
  high: { resScale: 0.8, steps: 460 },
} as const;
type QualityKey = keyof typeof QUALITY;
const QUALITY_ORDER: QualityKey[] = ['low', 'medium', 'high'];
const QUALITY_LABEL: Record<QualityKey, string> = { low: '低', medium: '中', high: '高' };

const params = {
  quality: 'medium' as QualityKey,
  beaming: 1.0,
};

// —— 游戏状态 ——
const ship: ShipState = initialShip();
const state: GameState = {
  mode: 'flight',
  paused: false,
  simTime: 0,
  shipTime: 0,
  warp: 1,
  cameraMode: 0,
  hudVisible: true,
  autoBrake: false,
};

const camera = new THREE.PerspectiveCamera(60, 1, 0.02, 500);
camera.position.set(0, 2.6, 15.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.5;
controls.maxDistance = 60;
controls.enabled = false; // 自由机位时才启用

const input = new Input(renderer.domElement);
appendHudStyles();
const hud = new Hud();
hud.setObjective('自由飞行 — 拖拽转向 · W 推进 · Z 时间加速 · C 切换机位 · X 自动刹车');

// —— 黑洞测地线渲染目标（半分辨率） ——
const rt = new THREE.WebGLRenderTarget(2, 2, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  stencilBuffer: false,
});

const bhUniforms = {
  uCamWorld: { value: new THREE.Matrix4() },
  uProjInv: { value: new THREE.Matrix4() },
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uMaxSteps: { value: QUALITY.medium.steps as number },
  uDiskInner: { value: 3.0 },
  uDiskOuter: { value: 13.0 },
  uTempPeak: { value: 5200 },
  uBeaming: { value: params.beaming },
  uExposure: { value: 1.8 },
  uOmega: { value: 1.1 },
  uFlowPeriod: { value: 26.0 },
  uPixelAngle: { value: 0.001 },
  uMwNormal: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
};

const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
// 背景单独渲染进低分辨率 RT；合成场景里再画一份（同一材质）作为 3D 物体的底
const bhScene = new THREE.Scene();
const bhMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: bhUniforms,
  vertexShader: fullscreenVertex,
  fragmentShader: blackholeFragment,
  depthTest: false,
  depthWrite: false,
});
const bhQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhMaterial);
bhQuad.frustumCulled = false;
bhScene.add(bhQuad);

const compScene = new THREE.Scene();
const bhQuadBg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bhMaterial);
bhQuadBg.frustumCulled = false;
bhQuadBg.renderOrder = -1;
compScene.add(bhQuadBg);

// —— 飞船 / 轨道线 / 灯光（叠加在同一台相机上） ——
const keyLight = new THREE.DirectionalLight(0xffd9a8, 2.2);
keyLight.position.set(0.3, -1, 0.4);
compScene.add(keyLight);
compScene.add(new THREE.AmbientLight(0x404860, 0.9));

const shipVisual = createShipVisual();
compScene.add(shipVisual.group);

const predictor = new OrbitPredictor();
compScene.add(predictor.line);

const compUniforms = { uTex: { value: rt.texture } };
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType }),
);
composer.addPass(new RenderPass(compScene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.55, 0.4, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const q = QUALITY[params.quality];
  const rw = Math.max(2, Math.floor(w * dpr * q.resScale));
  const rh = Math.max(2, Math.floor(h * dpr * q.resScale));
  rt.setSize(rw, rh);
  composer.setSize(w * dpr, h * dpr);
  bloom.setSize(w * dpr, h * dpr);
  bhUniforms.uMaxSteps.value = q.steps;
  bhUniforms.uPixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / rh;
}
window.addEventListener('resize', resize);
resize();

// —— 既有面板按钮 ——
const btnQuality = document.getElementById('btnQuality') as HTMLButtonElement;
const btnBeam = document.getElementById('btnBeam') as HTMLButtonElement;
const btnOrbit = document.getElementById('btnOrbit') as HTMLButtonElement;
btnOrbit.parentElement?.removeChild(btnOrbit); // 自动巡航被飞船控制取代

btnQuality.addEventListener('click', () => {
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(params.quality) + 1) % QUALITY_ORDER.length];
  params.quality = next;
  btnQuality.textContent = `画质 · ${QUALITY_LABEL[next]}`;
  resize();
});

btnBeam.addEventListener('click', () => {
  const real = params.beaming > 0.6;
  params.beaming = real ? 0.25 : 1.0;
  btnBeam.textContent = real ? '聚束 · 电影' : '聚束 · 真实';
  btnBeam.classList.toggle('on', real);
});

// —— 任务系统 ——
appendUiStyles();
const markers = new Markers();
compScene.add(markers.group);

const flags = new Set<string>();
let missionIndex = -1; // -1 = 自由飞行
let objectiveIdx = 0;
let activeWaypoints: MissionWaypoint[] = [];
let heatWarned = false;
let menuTime = 0;

function lookAlongDir(x: number, y: number, z: number) {
  const dir = new THREE.Vector3(x, y, z).normalize();
  // Matrix4.lookAt(eye, target) 使 +Z 轴指向 (eye - target)，故 eye=dir 让船首(+Z)对准 dir
  const m = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  ship.quat.setFromRotationMatrix(m);
}

// 探测器特效：向黑洞坠落的发光体
const probes: { sprite: THREE.Sprite; vel: THREE.Vector3; t: number }[] = [];
function glowTexture(hex: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = (hex >> 16) & 255;
  const gg = (hex >> 8) & 255;
  const b = hex & 255;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const fx: MissionFx = {
  flash() {
    let el = document.getElementById('eh-flash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'eh-flash';
      document.body.appendChild(el);
    }
    el.style.transition = 'none';
    el.style.opacity = '0.85';
    requestAnimationFrame(() => {
      el!.style.transition = 'opacity 0.9s ease';
      el!.style.opacity = '0';
    });
  },
  spawnProbe(from) {
    const pos = new THREE.Vector3(from.x, from.y, from.z);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(0xbfe0ff),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    sprite.position.copy(pos);
    sprite.scale.set(0.35, 0.35, 1);
    compScene.add(sprite);
    probes.push({ sprite, vel: pos.clone().normalize().multiplyScalar(-0.45), t: 0 });
  },
};

const ctx: MissionCtx = {
  ship,
  state,
  flags,
  toast: (m) => hud.toast(m, 2600),
  lookAlong: lookAlongDir,
  fx,
};

function setObjectiveHud() {
  if (missionIndex < 0) {
    hud.setObjective('自由飞行 — 拖拽转向 · W 推进 · Z 时间加速 · C 切换机位 · X 自动刹车');
    return;
  }
  const objs = MISSIONS[missionIndex].objectives;
  hud.setObjective(
    objs
      .map((o, i) => {
        const done = i < objectiveIdx;
        const cur = i === objectiveIdx;
        return `<div class="${done ? 'obj-done' : ''}">${done ? '✓' : cur ? '▸' : '·'} ${o.text}</div>`;
      })
      .join(''),
  );
}

function showMenuMode() {
  state.mode = 'menu';
  state.paused = true;
  missionIndex = -1;
  state.warp = 1;
  hud.setVisible(false);
  markers.setVisible(false);
  shipVisual.group.visible = false;
  predictor.line.visible = false;
  ui.showMenu(savedProgress());
}

function launchMission(i: number) {
  const mission = MISSIONS[i];
  if (!mission) return launchFreeFlight();
  missionIndex = i;
  objectiveIdx = 0;
  flags.clear();
  heatWarned = false;
  activeWaypoints = mission.waypoints ?? [];
  state.mode = 'flight';
  state.paused = false;
  state.warp = 1;
  state.autoBrake = false;
  state.simTime = 0;
  state.shipTime = 0;
  ship.heat = 0;
  mission.setup(ctx);
  markers.set(activeWaypoints);
  markers.setVisible(true);
  shipVisual.group.visible = true;
  predictor.line.visible = true;
  hud.setVisible(true);
  ui.hideAll();
  setObjectiveHud();
  hud.toast(mission.title, 3000);
}

function launchFreeFlight() {
  missionIndex = -1;
  objectiveIdx = 0;
  flags.clear();
  activeWaypoints = [];
  state.mode = 'flight';
  state.paused = false;
  state.warp = 1;
  state.autoBrake = false;
  state.simTime = 0;
  state.shipTime = 0;
  Object.assign(ship, initialShip());
  ship.fuel = 9999;
  markers.set([]);
  markers.setVisible(false);
  shipVisual.group.visible = true;
  predictor.line.visible = true;
  hud.setVisible(true);
  ui.hideAll();
  setObjectiveHud();
  hud.toast('自由飞行 — 黑洞属于你', 3000);
}

function completeMission() {
  const mission = MISSIONS[missionIndex];
  saveProgress(missionIndex + 1);
  state.paused = true;
  const next = missionIndex + 1;
  ui.showComplete(
    mission.title,
    mission.complete,
    next < MISSIONS.length ? MISSIONS[next].title : '全部完成 · 自由飞行',
    () => {
      if (next < MISSIONS.length) ui.showBrief(MISSIONS[next].title, MISSIONS[next].brief, () => launchMission(next));
      else launchFreeFlight();
    },
  );
}

function failMission(reason: string) {
  state.paused = true;
  ui.showFail(reason, () => launchMission(missionIndex));
}

function updateHeat(dtSim: number) {
  const r = ship.pos.length();
  const y = Math.abs(ship.pos.y);
  let rate = 90 / (r * r); // 黑洞辐射基线
  if (r < 14 && r > 2.8 && y < 2.5) rate += (450 / (r * r)) * (1 - y / 2.5); // 贴近盘面
  rate -= 1.4; // 主动冷却
  ship.heat = Math.min(130, Math.max(0, ship.heat + rate * dtSim));
  if (ship.heat > 70 && !heatWarned) {
    heatWarned = true;
    hud.toast('警告：船体过热！', 3000);
  }
  if (ship.heat < 55) heatWarned = false;
}

const ui = new Ui({
  onStartMission: (i) => ui.showBrief(MISSIONS[i].title, MISSIONS[i].brief, () => launchMission(i)),
  onFreeFlight: launchFreeFlight,
  onRetry: () => launchMission(missionIndex),
  onMenu: showMenuMode,
});
showMenuMode();

// —— 键盘动作 ——
const CAM_NAMES = ['追尾', '座舱', '自由'];
window.addEventListener('keydown', (e) => {
  if (state.mode !== 'flight') return;
  if (e.code === 'KeyZ') {
    const idx = WARP_STEPS.indexOf(state.warp);
    state.warp = WARP_STEPS[(idx + 1) % WARP_STEPS.length];
    flags.add('warp');
    hud.toast(`时间 ×${state.warp}`, 1200);
  } else if (e.code === 'KeyC') {
    state.cameraMode = ((state.cameraMode + 1) % 3) as 0 | 1 | 2;
    controls.enabled = state.cameraMode === 2;
    if (state.cameraMode === 2) {
      controls.target.copy(ship.pos);
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.quat);
      camera.position.copy(ship.pos).addScaledVector(dir, -3).add(new THREE.Vector3(0, 1, 0.5));
    }
    hud.toast(`机位 · ${CAM_NAMES[state.cameraMode]}`, 1200);
  } else if (e.code === 'KeyX') {
    state.autoBrake = !state.autoBrake;
    hud.toast(state.autoBrake ? '自动刹车 · 开' : '自动刹车 · 关', 1200);
  } else if (e.code === 'KeyH') {
    state.hudVisible = !state.hudVisible;
    hud.setVisible(state.hudVisible);
  } else if (e.code === 'KeyT' && missionIndex >= 0) {
    MISSIONS[missionIndex].onKey?.(e.code, ctx);
  }
});

// —— 飞船姿态（拖拽转向 + Q/E 滚转） ——
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
function updateAttitude(dt: number) {
  const { yaw, pitch } = input.consumeLook();
  const roll = (input.down('KeyQ') ? 1 : 0) - (input.down('KeyE') ? 1 : 0);
  const q = new THREE.Quaternion();
  if (yaw !== 0) ship.quat.multiply(q.setFromAxisAngle(AXIS_Y, -yaw));
  if (pitch !== 0) ship.quat.multiply(q.setFromAxisAngle(AXIS_X, -pitch));
  if (roll !== 0) ship.quat.multiply(q.setFromAxisAngle(AXIS_Z, roll * dt * 1.8));
  ship.quat.normalize();
}

// —— 相机 ——
const camTargetPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const tmpV = new THREE.Vector3();
function updateCamera(dt: number) {
  if (state.mode === 'menu') {
    // 主菜单：绕黑洞缓慢巡航的电影镜头
    menuTime += dt;
    const t = menuTime * 0.045;
    camera.position.set(Math.sin(t) * 17, 4.6 + Math.sin(menuTime * 0.11) * 1.2, Math.cos(t) * 17);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    return;
  }
  const forward = tmpV.set(0, 0, 1).applyQuaternion(ship.quat).clone();
  if (state.cameraMode === 0) {
    // 追尾
    const back = forward.clone().multiplyScalar(-2.4);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quat);
    camTargetPos.copy(ship.pos).add(back).addScaledVector(up, 0.8);
    const k = 1 - Math.exp(-dt * 10);
    camera.position.lerp(camTargetPos, k);
    lookAt.copy(ship.pos).addScaledVector(forward, 8);
    camera.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quat));
    camera.lookAt(lookAt);
  } else if (state.cameraMode === 1) {
    // 座舱
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quat);
    camera.position.copy(ship.pos).addScaledVector(forward, 0.25).addScaledVector(up, 0.1);
    camera.quaternion.copy(ship.quat);
  } else {
    controls.target.lerp(ship.pos, 1 - Math.exp(-dt * 6));
    controls.update();
  }
}

// —— 调试接口（自动化验收用） ——
(window as unknown as Record<string, unknown>).__eh = {
  ship,
  state,
  hud,
  input,
  flags,
  get r() {
    return ship.pos.length();
  },
  get speed() {
    return ship.vel.length();
  },
  get mission() {
    return missionIndex;
  },
  get obj() {
    return objectiveIdx;
  },
  launchMission: (i: number) => launchMission(i),
  startFree: () => launchFreeFlight(),
  // 将飞船姿态对准给定方向（默认沿速度方向）
  lookAlong(x: number, y: number, z: number) {
    lookAlongDir(x, y, z);
  },
};

// —— 主循环 ——
const clock = new THREE.Clock();
const thrustDir = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
let frame = 0;
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  frame++;

  updateAttitude(dt);

  // 推进方向：手动输入 or 自动刹车
  thrustDir.set(0, 0, 0);
  const manual = ship.fuel > 0 ? input.thrustDir(ship.quat, tmpDir) : false;
  if (manual) {
    thrustDir.copy(tmpDir);
  } else if (state.autoBrake && ship.fuel > 0 && ship.vel.lengthSq() > 1e-6) {
    thrustDir.copy(ship.vel).normalize().multiplyScalar(-1);
    if (ship.vel.length() < 0.003) {
      ship.vel.set(0, 0, 0);
      thrustDir.set(0, 0, 0);
      state.autoBrake = false;
      hud.toast('速度已归零，自动刹车关闭', 1600);
    }
  }
  const throttle = thrustDir.lengthSq() > 0 ? 1 : 0;
  ship.throttle += (throttle - ship.throttle) * (1 - Math.exp(-dt * 12));
  shipVisual.setThrottle(ship.throttle);

  // 时间倍率上限随距离收紧
  const r = ship.pos.length();
  const cap = maxWarpFor(r);
  if (state.warp > cap) {
    state.warp = cap;
  }

  if (!state.paused && ship.alive) {
    const dtSim = dt * state.warp;
    const res = integrateShip(ship, dtSim, thrustDir);
    const dil = dilation(ship.pos.length(), ship.vel.length());
    state.simTime += dtSim;
    state.shipTime += dtSim * dil;
    updateHeat(dtSim);

    // 坠洞 / 过热
    if (res.crashed) {
      ship.alive = false;
      if (missionIndex >= 0) failMission('飞船越过事件视界，信号终止于无限红移。');
      else hud.toast('你越过了事件视界 — 按 R 重生', 8000);
    } else if (ship.heat >= 100) {
      ship.alive = false;
      if (missionIndex >= 0) failMission('船体过热，结构解体。下次离盘面远一点。');
      else hud.toast('船体过热解体 — 按 R 重生', 8000);
    }
  }

  // 自由飞行的重生
  if (!ship.alive && missionIndex < 0 && input.down('KeyR')) {
    Object.assign(ship, initialShip());
    ship.fuel = 9999;
    state.simTime = 0;
    state.shipTime = 0;
    state.warp = 1;
    hud.toast('已重生至安全轨道', 2000);
  }

  // 任务推进：航点 / 目标
  if (state.mode === 'flight' && !state.paused && missionIndex >= 0 && ship.alive) {
    for (let i = 0; i < activeWaypoints.length; i++) {
      if (flags.has(`wp${i}`)) continue;
      const wp = activeWaypoints[i];
      const d = ship.pos.distanceTo(new THREE.Vector3(wp.pos[0], wp.pos[1], wp.pos[2]));
      const distEl = markers.labelAt(i);
      if (distEl) distEl.textContent = `${d.toFixed(1)} Rs`;
      if (d < wp.radius) {
        flags.add(`wp${i}`);
        hud.toast('已抵达标记 — 采样中…', 2400);
      }
    }
    const objs = MISSIONS[missionIndex].objectives;
    if (objectiveIdx < objs.length && objs[objectiveIdx].check(ctx)) {
      objectiveIdx++;
      if (objectiveIdx === objs.length) {
        completeMission();
      } else {
        hud.toast(`目标完成 ${objectiveIdx}/${objs.length}`, 2200);
        setObjectiveHud();
      }
    }
    markers.update(camera, bhUniforms.uTime.value);
  }

  // 探测器动画
  for (let i = probes.length - 1; i >= 0; i--) {
    const p = probes[i];
    p.t += dt;
    p.sprite.position.addScaledVector(p.vel, dt * state.warp);
    const fade = Math.max(0, 1 - Math.max(0, p.t - 1.5) / 1.5);
    (p.sprite.material as THREE.SpriteMaterial).opacity = fade;
    if (p.t > 3 || p.sprite.position.length() < 1.2) {
      compScene.remove(p.sprite);
      probes.splice(i, 1);
    }
  }

  shipVisual.group.position.copy(ship.pos);
  shipVisual.group.quaternion.copy(ship.quat);

  updateCamera(dt);

  if (frame % 3 === 0) predictor.update(ship.pos, ship.vel);

  if (state.hudVisible) hud.update(state, ship, camera);

  // 黑洞背景渲染
  camera.updateMatrixWorld();
  bhUniforms.uCamWorld.value.copy(camera.matrixWorld);
  bhUniforms.uCamPos.value.copy(camera.position);
  bhUniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
  bhUniforms.uTime.value += dt;
  bhUniforms.uBeaming.value = params.beaming;

  renderer.setRenderTarget(rt);
  renderer.render(bhScene, orthoCam);
  renderer.setRenderTarget(null);
  composer.render();
}
tick();
