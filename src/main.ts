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
import { SYSTEMS, systemByMission, companionPos, type StarSystem } from './systems';
import { buildSky, dirToEquirect, starLabel, type NamedStar } from './sky';
import {
  gravityAccel,
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

// 天球纹理（HYG 星表烘焙目标）：与主 RT 同一模式——先创建并绑定，后异步填充
const skyRt = new THREE.WebGLRenderTarget(4096, 2048, {
  type: THREE.HalfFloatType,
  depthBuffer: false,
  stencilBuffer: false,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.RepeatWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
});

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
  uSkyTex: { value: skyRt.texture },
  uSkyRot: { value: new THREE.Matrix3() },
  uJet: { value: 1.0 },
  uJetLen: { value: 30.0 },
  uStream: { value: 1.0 },
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
const compMat = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: compUniforms,
  vertexShader: fullscreenVertex,
  fragmentShader: compositeFragment,
  depthTest: false,
  depthWrite: false,
});
const compQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat);
compQuad.frustumCulled = false;
compScene.add(compQuad);

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
}
window.addEventListener('resize', resize);
resize();

// —— 既有面板按钮 ——
const btnQuality = document.getElementById('btnQuality') as HTMLButtonElement;
const btnBeam = document.getElementById('btnBeam') as HTMLButtonElement;
const btnOrbit = document.getElementById('btnOrbit') as HTMLButtonElement;
btnOrbit.parentElement?.removeChild(btnOrbit); // 自动巡航被飞船控制取代

function persistSettings() {
  localStorage.setItem('eh-settings', JSON.stringify({ quality: params.quality, beaming: params.beaming }));
}
try {
  const savedSettings = JSON.parse(localStorage.getItem('eh-settings') ?? '{}');
  if (savedSettings.quality && QUALITY_ORDER.includes(savedSettings.quality)) {
    params.quality = savedSettings.quality;
    btnQuality.textContent = `画质 · ${QUALITY_LABEL[params.quality as QualityKey]}`;
  }
  if (typeof savedSettings.beaming === 'number') {
    params.beaming = savedSettings.beaming;
    btnBeam.textContent = params.beaming > 0.6 ? '聚束 · 真实' : '聚束 · 电影';
    btnBeam.classList.toggle('on', params.beaming > 0.6);
  }
} catch {
  // 忽略损坏的设置
}

btnQuality.addEventListener('click', () => {
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(params.quality) + 1) % QUALITY_ORDER.length];
  params.quality = next;
  btnQuality.textContent = `画质 · ${QUALITY_LABEL[next]}`;
  persistSettings();
  resize();
});

btnBeam.addEventListener('click', () => {
  const real = params.beaming > 0.6;
  params.beaming = real ? 0.25 : 1.0;
  btnBeam.textContent = real ? '聚束 · 电影' : '聚束 · 真实';
  btnBeam.classList.toggle('on', real);
  persistSettings();
});

// —— 救援关 NPC：失控货船（沿坠落轨道） ——
let derelict: {
  mesh: THREE.Group;
  label: HTMLElement;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  docked: boolean;
} | null = null;

function spawnDerelict() {
  const mesh = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.13, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x4a4640, metalness: 0.6, roughness: 0.6 }),
  );
  mesh.add(hull);
  const beacon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(0xff5a4a),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  beacon.scale.set(0.5, 0.5, 1);
  mesh.add(beacon);
  compScene.add(mesh);

  const label = document.createElement('div');
  label.className = 'eh-marker-label';
  label.style.color = '#ff9d8c';
  label.innerHTML = `◈ 失控货船<br><span class="dist"></span>`;
  (document.getElementById('eh-markers') ?? document.body).appendChild(label);

  derelict = {
    mesh,
    label,
    pos: new THREE.Vector3(20, 4, -6),
    vel: new THREE.Vector3(-0.12, -0.02, -0.02),
    docked: false,
  };
}

function removeDerelict() {
  if (!derelict) return;
  compScene.remove(derelict.mesh);
  derelict.label.remove();
  derelict = null;
}

const tmpV2 = new THREE.Vector3();
function updateDerelict(dtSim: number) {
  if (!derelict) return;
  if (!derelict.docked) {
    const h = 0.02;
    let remain = dtSim;
    while (remain > 1e-6) {
      const step = Math.min(h, remain);
      remain -= step;
      gravityAccel(derelict.pos, tmpV2);
      derelict.vel.addScaledVector(tmpV2, step);
      derelict.pos.addScaledVector(derelict.vel, step);
      if (derelict.pos.length() < 1.05) {
        const mission = MISSIONS[missionIndex];
        if (mission?.special === 'derelict' && !flags.has('dock')) {
          removeDerelict();
          failMission('货船坠入了视界。一千名冬眠者，成了永恒的一部分。');
          return;
        }
        break;
      }
    }
  } else {
    derelict.pos.copy(ship.pos);
  }
  derelict.mesh.position.copy(derelict.pos);
  derelict.mesh.rotation.y += 0.01 * state.warp;

  const d = ship.pos.distanceTo(derelict.pos);
  if (d < 1.2) flags.add('near');
  const p = derelict.pos.clone().project(camera);
  if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
    derelict.label.style.display = 'none';
  } else {
    derelict.label.style.display = '';
    derelict.label.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    derelict.label.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
    (derelict.label.querySelector('.dist') as HTMLElement).textContent = `${d.toFixed(1)} Rs`;
  }
}

// —— 终章：双结局 ——
let finaleChoiceShown = false;
let finaleMode: 'none' | 'escape' | 'fall' = 'none';
let finaleEscapeT = 0;
const fadeEl = document.createElement('div');
fadeEl.style.cssText =
  'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:35;transition:opacity 0.4s;';
document.body.appendChild(fadeEl);

function offerFinaleChoice() {
  finaleChoiceShown = true;
  state.paused = true;
  ui.showChoice(
    '视界在你面前',
    [
      '船体在 2.6 Rs 处震颤——已越过光子球，天空中的黑圆比太阳大一百倍。',
      '返航窗口只剩最后几秒——越过它，任何引擎都无法再改写结局。',
    ],
    [
      {
        label: '点燃返航引擎（结局 A）',
        primary: true,
        cb: () => {
          ui.hideAll();
          flags.add('chosen');
          finaleMode = 'escape';
          finaleEscapeT = 0;
          state.paused = false;
          {
            const r = ship.pos.length();
            const vEsc = Math.min(0.92, Math.sqrt(1 / Math.max(r - 1, 0.2)) * 1.08);
            ship.vel.copy(ship.pos).normalize().multiplyScalar(vEsc);
          }
          fx.flash();
          hud.toast('返航引擎 · 全功率点火', 3000);
        },
      },
      {
        label: '继续坠落（结局 B）',
        cb: () => {
          ui.hideAll();
          flags.add('chosen');
          finaleMode = 'fall';
          state.paused = false;
          hud.toast('引擎熄火。让引力接管一切。', 3000);
        },
      },
    ],
  );
}

function updateFinale() {
  if (missionIndex < 0 || MISSIONS[missionIndex]?.special !== 'finale') return;
  if (!flags.has('chosen') && !finaleChoiceShown && ship.pos.length() < 2.6) {
    offerFinaleChoice();
    return;
  }
  if (finaleMode === 'fall') {
    const r = ship.pos.length();
    fadeEl.style.opacity = String(Math.min(1, Math.max(0, (1.3 - r) / 0.3)));
    if (r < 1.04) {
      finaleMode = 'none';
      fadeEl.style.opacity = '0';
      state.paused = true;
      ui.showEnding('结局 B · 坠入永恒', [
        '在越过视界的那一刻，你没有感到任何异样——广义相对论早就预言了这一点。',
        '但你发出的每一束光，都永远留在了外面。',
        '对宇宙而言，你只是被拉长为一线微弱的红移，缓缓写下，再也不会被读到。',
      ]);
    }
  }
}

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
  dockDerelict() {
    if (derelict && !derelict.docked) {
      derelict.docked = true;
      return true;
    }
    return false;
  },
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

// —— 伴星（蓝超巨星）与洛希瓣物质流 ——
interface CompanionRuntime {
  group: THREE.Group;
  label: HTMLElement;
  pos: THREE.Vector3;
}
let companion: CompanionRuntime | null = null;
let rocheStream: THREE.Mesh | null = null;
let rocheStreamSys: StarSystem | null = null;

function starSurfaceMaterial(tempK: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTemp: { value: tempK }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec3 vPosL;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vPosL = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vNormalW;
      varying vec3 vWorldPos;
      varying vec3 vPosL;
      uniform float uTemp;
      uniform float uTime;
      float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
      }
      float vnoise3(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
          mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
      }
      vec3 blackbody(float kelvin) {
        float t = clamp(kelvin, 1000.0, 40000.0) / 100.0;
        float r; float g; float b;
        if (t <= 66.0) { r = 255.0; g = 99.4708 * log(t) - 161.1196; }
        else { r = 329.6987 * pow(t - 60.0, -0.1332); g = 288.1222 * pow(t - 60.0, -0.0755); }
        if (t >= 66.0) { b = 255.0; } else if (t <= 19.0) { b = 0.0; }
        else { b = 138.5177 * log(t - 10.0) - 305.0448; }
        vec3 c = clamp(vec3(r, g, b) / 255.0, vec3(0.0), vec3(1.0));
        return pow(c, vec3(2.2));
      }
      void main() {
        // 临边昏暗：视向越切，表面越暗
        float limb = pow(max(dot(vNormalW, normalize(cameraPosition - vWorldPos)), 0.0), 0.45);
        // 米粒组织
        float g1 = vnoise3(vPosL * 2.2 + vec3(uTime * 0.02));
        float g2 = vnoise3(vPosL * 5.5 - vec3(uTime * 0.03));
        float gran = 0.82 + 0.18 * g1 + 0.08 * g2;
        vec3 col = blackbody(uTemp) * limb * gran * 1.6;
        // 色球层边缘泛红
        float rim = pow(1.0 - limb, 2.5);
        col += vec3(1.0, 0.45, 0.2) * rim * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

function spawnCompanion(sys: StarSystem) {
  const c = sys.companion!;
  const group = new THREE.Group();
  const star = new THREE.Mesh(new THREE.SphereGeometry(c.radius, 48, 32), starSurfaceMaterial(c.temp));
  group.add(star);
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(0xbfd8ff),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.4,
    }),
  );
  corona.scale.set(c.radius * 4.2, c.radius * 4.2, 1);
  group.add(corona);
  compScene.add(group);

  const label = document.createElement('div');
  label.className = 'eh-marker-label';
  label.style.color = '#cfe4ff';
  label.innerHTML = `★ ${c.name}<br><span class="dist"></span>`;
  (document.getElementById('eh-markers') ?? document.body).appendChild(label);

  const pos = companionPos(sys, state.simTime, new THREE.Vector3());
  companion = { group, label, pos };

  // 洛希瓣物质流：伴星表面 → 吸积盘外缘
  const l1 = pos.clone().multiplyScalar(1 - c.radius / pos.length() * 0.9);
  const curve = new THREE.CatmullRomCurve3([
    pos.clone().multiplyScalar(1 - c.radius / pos.length()),
    new THREE.Vector3(50, 2.2, 9),
    new THREE.Vector3(36, 1.8, 10),
    new THREE.Vector3(24, 0.8, 5.5),
    new THREE.Vector3(sys.disk.outer - 0.4, 0.05, 0.5),
  ]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 160, 0.3, 8, false),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uExposure: { value: 1.2 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv2;
        void main() {
          vUv2 = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv2;
        uniform float uTime;
        uniform float uExposure;
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float vnoise2(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1,0)), u.x), mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), u.x), u.y);
        }
        void main() {
          // 沿流向滚动的湍流丝缕
          float n = vnoise2(vec2(vUv2.x * 26.0 - uTime * 0.9, vUv2.y * 7.0));
          n = 0.45 + 0.55 * n;
          float ends = smoothstep(0.0, 0.12, vUv2.x) * (1.0 - smoothstep(0.85, 1.0, vUv2.x));
          vec3 warm = vec3(1.0, 0.82, 0.6);
          vec3 cool = vec3(0.75, 0.85, 1.0);
          vec3 col = mix(cool, warm, vUv2.x) * n * uExposure * 0.9;
          float alpha = 0.42 * ends;
          gl_FragColor = vec4(col * ends, alpha);
        }
      `,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  );
  compScene.add(tube);
  rocheStream = tube;
  rocheStreamSys = sys;
}

function removeCompanion() {
  if (!companion) return;
  compScene.remove(companion.group);
  companion.label.remove();
  companion = null;
  if (rocheStream) {
    compScene.remove(rocheStream);
    rocheStream.geometry.dispose();
    rocheStream = null;
  }
}

const tmpV3 = new THREE.Vector3();
function updateCompanion(dtSim: number) {
  if (!companion) return;
  const sys = currentSystem;
  companionPos(sys, state.simTime, tmpV3);
  companion.pos.copy(tmpV3);
  companion.group.position.copy(tmpV3);
  const mat = (companion.group.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
  mat.uniforms.uTime.value += dtSim;
  if (rocheStream && rocheStreamSys) {
    (rocheStream.material as THREE.ShaderMaterial).uniforms.uTime.value += dtSim;
    // 参数化内旋螺旋：始终从伴星当前位置旋入吸积盘外缘（任意轨道相位都物理连贯）
    const comp = rocheStreamSys.companion!;
    const a0 = Math.atan2(tmpV3.z, tmpV3.x);
    const r0 = Math.hypot(tmpV3.x, tmpV3.z);
    const y0 = tmpV3.y;
    const rIn = rocheStreamSys.disk.outer - 0.4;
    const ctrl: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const ease = t * t * (3 - 2 * t);
      const ang = a0 - ease * 1.35; // 内旋 1.35 rad
      const rad = r0 + (rIn - r0) * ease;
      ctrl.push(new THREE.Vector3(Math.cos(ang) * rad, y0 + (0.05 - y0) * ease, Math.sin(ang) * rad));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl);
    const oldGeo = rocheStream.geometry;
    rocheStream.geometry = new THREE.TubeGeometry(curve, 110, 0.3, 6, false);
    oldGeo.dispose();
  }
  // 标签
  const d = ship.pos.distanceTo(companion.pos);
  const p = companion.pos.clone().project(camera);
  if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) {
    companion.label.style.display = 'none';
  } else {
    companion.label.style.display = '';
    companion.label.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    companion.label.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
    (companion.label.querySelector('.dist') as HTMLElement).textContent = `${d.toFixed(1)} Rs`;
  }
}

// —— 曲率跳跃：相对论星流隧道 ——
function playWarpJump(onDone: () => void) {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;z-index:45;';
  document.body.appendChild(cv);
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  const g = cv.getContext('2d')!;
  const N = 420;
  const stars = Array.from({ length: N }, () => ({
    a: Math.random() * Math.PI * 2,
    r: Math.random() * 60,
    v: 0.4 + Math.random() * 2.4,
    b: 0.4 + Math.random() * 0.6,
  }));
  const t0 = performance.now();
  const DUR = 2300;
  function frame() {
    const t = performance.now() - t0;
    const fade = t < 300 ? t / 300 : t > DUR - 500 ? Math.max(0, (DUR - t) / 500) : 1;
    g.fillStyle = `rgba(2,3,8,${0.35})`;
    g.fillRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    for (const st of stars) {
      st.r *= 1.06 * st.v * 0.12 + 0.06;
      if (st.r > Math.hypot(cx, cy)) {
        st.r = Math.random() * 40;
        st.a = Math.random() * Math.PI * 2;
      }
      const len = st.r * 0.14 * st.v;
      const x1 = cx + Math.cos(st.a) * st.r;
      const y1 = cy + Math.sin(st.a) * st.r;
      const x2 = cx + Math.cos(st.a) * (st.r + len);
      const y2 = cy + Math.sin(st.a) * (st.r + len);
      // 越快越蓝（多普勒蓝移可视化）
      const blue = Math.min(1, st.v / 2.8);
      g.strokeStyle = `rgba(${Math.round(160 * st.b)},${Math.round(200 - 60 * blue)},${Math.round(255)},${st.b * fade})`;
      g.lineWidth = 1 + blue;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    if (t < DUR) requestAnimationFrame(frame);
    else {
      cv.remove();
      onDone();
    }
  }
  frame();
}

// —— 星系系统切换 ——
let currentSystem: StarSystem = SYSTEMS[0];

function applySystem(sys: StarSystem) {
  currentSystem = sys;
  bhUniforms.uDiskOuter.value = sys.disk.outer;
  bhUniforms.uTempPeak.value = sys.disk.tempPeak;
  bhUniforms.uExposure.value = sys.disk.exposure;
  bhUniforms.uJet.value = sys.jet;
  bhUniforms.uJetLen.value = sys.jetLen;
  bhUniforms.uStream.value = sys.stream;
  removeCompanion();
  if (sys.companion) spawnCompanion(sys);
}

const ctx: MissionCtx = {
  ship,
  state,
  flags,
  toast: (m) => hud.toast(m, 2600),
  lookAlong: lookAlongDir,
  fx,
  companionPos: () => (companion ? companion.pos : null),
  nearCompanion(dist: number) {
    if (!companion) return false;
    return ship.pos.distanceTo(companion.pos) < dist;
  },
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
  applySystem(SYSTEMS[0]);
  removeDerelict();
  finaleChoiceShown = false;
  finaleMode = 'none';
  fadeEl.style.opacity = '0';
  hud.setVisible(false);
  markers.setVisible(false);
  shipVisual.group.visible = false;
  predictor.line.visible = false;
  refreshDexCards();
  ui.showMenu(
    savedProgress(),
    SYSTEMS.slice(1).map((sys, idx) => ({
      label: `巡礼 · ${sys.name}${savedProgress() < sys.unlockAfter ? '（待解锁）' : ''}`,
      locked: savedProgress() < sys.unlockAfter,
      sysIndex: idx + 1,
    })),
  );
}

function launchMission(i: number) {
  const mission = MISSIONS[i];
  if (!mission) return launchFreeFlight();
  missionIndex = i;
  objectiveIdx = 0;
  flags.clear();
  heatWarned = false;
  activeWaypoints = mission.waypoints ?? [];
  const sys = systemByMission(i);
  if (sys.id !== currentSystem.id) {
    applySystem(sys);
    fx.flash();
    hud.toast(`曲率跳跃 → ${sys.name}（${sys.realName}）`, 3200);
  }
  state.mode = 'flight';
  state.paused = false;
  state.warp = 1;
  state.autoBrake = false;
  state.simTime = 0;
  state.shipTime = 0;
  ship.heat = 0;
  finaleChoiceShown = false;
  finaleMode = 'none';
  finaleEscapeT = 0;
  fadeEl.style.opacity = '0';
  removeDerelict();
  if (mission.special === 'derelict') spawnDerelict();
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
  saveProgress(Math.max(savedProgress(), missionIndex + 1)); // 进度只前进不回退
  state.paused = true;
  removeDerelict();
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
  removeDerelict();
  ui.showFail(reason, () => launchMission(missionIndex));
}

function updateHeat(dtSim: number) {
  const r = ship.pos.length();
  const y = Math.abs(ship.pos.y);
  let rate = 90 / (r * r); // 黑洞辐射基线
  if (companion) {
    const d = ship.pos.distanceTo(companion.pos);
    rate += 120 / (d * d); // 伴星辐照
  }
  if (r < 14 && r > 2.8 && y < 2.5) rate += (450 / (r * r)) * (1 - y / 2.5); // 贴近盘面
  rate -= 1.4; // 主动冷却
  ship.heat = Math.min(130, Math.max(0, ship.heat + rate * dtSim));
  if (ship.heat > 70 && !heatWarned) {
    heatWarned = true;
    hud.toast('警告：船体过热！', 3000);
  }
  if (ship.heat < 55) heatWarned = false;
}

// —— 真实星空（HYG 星表烘焙）与星图模式 ——
const namedStars: NamedStar[] = [];
const labelPool: HTMLElement[] = [];
const labelDirs: THREE.Vector3[] = [];
let starMapOn = false;
const starMapLines = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.55 }),
);
starMapLines.visible = false;
starMapLines.frustumCulled = false;
compScene.add(starMapLines);

const starLabelBox = document.createElement('div');
starLabelBox.id = 'eh-starlabels';
starLabelBox.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11;display:none;';
document.body.appendChild(starLabelBox);

initSky();
async function initSky() {
  try {
    const sky = await buildSky(renderer, skyRt);
    bhUniforms.uSkyTex.value = sky.texture;
    namedStars.push(...sky.namedStars);

    // 星座连线（半径 100 的天球，过同一天空旋转）
    const verts: number[] = [];
    const v1 = new THREE.Vector3();
    for (const c of sky.constellations) {
      for (let i = 0; i < c.stars.length; i += 2) {
        v1.copy(c.stars[i].dir).applyMatrix3(bhUniforms.uSkyRot.value).multiplyScalar(100);
        verts.push(v1.x, v1.y, v1.z);
        v1.copy(c.stars[i + 1].dir).applyMatrix3(bhUniforms.uSkyRot.value).multiplyScalar(100);
        verts.push(v1.x, v1.y, v1.z);
      }
    }
    starMapLines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));

    // 标签池（亮星 mag ≤ 2.6）
    const bright = sky.namedStars.filter((st) => st.mag <= 2.6).slice(0, 44);
    for (const st of bright) {
      const el = document.createElement('div');
      el.className = 'eh-starlabel';
      el.textContent = starLabel(st);
      el.style.display = 'none';
      starLabelBox.appendChild(el);
      labelPool.push(el);
      labelDirs.push(st.dir.clone());
    }
    console.log(`[天空] 真实星表加载完成: ${sky.starCount} 颗恒星`);
  } catch (e) {
    console.error('星空烘焙失败，保留纯黑天空', e);
  }
}

function toggleStarMap() {
  starMapOn = !starMapOn;
  starMapLines.visible = starMapOn && starMapLines.geometry.getAttribute('position') !== undefined;
  starLabelBox.style.display = starMapOn ? '' : 'none';
  hud.toast(starMapOn ? '星图模式 · 开' : '星图模式 · 关', 1400);
}

// —— EHT 视角：科学渲染参数 + 广角定机位（模拟地球观测几何） ——
let ehtSaved: { beaming: number; exposure: number; camPos: THREE.Vector3; quat: THREE.Quaternion; camMode: 0 | 1 | 2 } | null = null;
function toggleEhtView() {
  if (!ehtSaved) {
    ehtSaved = {
      beaming: params.beaming,
      exposure: bhUniforms.uExposure.value,
      camPos: camera.position.clone(),
      quat: ship.quat.clone(),
      camMode: state.cameraMode,
    };
    params.beaming = 1.0; // EHT 照片包含真实聚束
    bhUniforms.uExposure.value = Math.min(bhUniforms.uExposure.value, 1.6);
    state.cameraMode = 0;
    state.autoBrake = false;
    ship.vel.set(0, 0, 0);
    // 正对黑洞的远景（等效地球观测几何：黑洞视角直径 ≈ EHT 影像构图）
    ship.pos.set(80, 8, 0);
    ship.vel.set(0, 0, 0);
    lookAlongDir(-80, -8, 0);
    camera.position.copy(ship.pos).add(new THREE.Vector3(-2.4, 1.2, 0));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    hud.toast('EHT 视角 · 已按地球观测几何对准（按 E 退出）', 3600);
  } else {
    params.beaming = ehtSaved.beaming;
    bhUniforms.uExposure.value = ehtSaved.exposure;
    ship.pos.copy(ehtSaved.camPos);
    ship.quat.copy(ehtSaved.quat);
    state.cameraMode = ehtSaved.camMode;
    ehtSaved = null;
    hud.toast('EHT 视角 · 已退出', 1600);
  }
  btnBeam.classList.toggle('on', params.beaming > 0.6);
  btnBeam.textContent = params.beaming > 0.6 ? '聚束 · 真实' : '聚束 · 电影';
}

const ui = new Ui({
  onStartMission: (i) => ui.showBrief(MISSIONS[i].title, MISSIONS[i].brief, () => launchMission(i)),
  onFreeFlight: launchFreeFlight,
  onRetry: () => launchMission(missionIndex),
  onMenu: showMenuMode,
  onTourSystem: (sysIdx) => {
    const sys = SYSTEMS[sysIdx];
    ui.showBrief(`巡礼 · ${sys.name}`, [sys.fact, '曲率跳跃引擎已充能。'], () => {
      fx.flash();
      launchMission(sys.missionOffset);
    });
  },
  onJumpSystem: (sysIdx) => {
    const sys = SYSTEMS[sysIdx];
    playWarpJump(() => {
      applySystem(sys);
      launchFreeFlight();
      hud.toast(`抵达 ${sys.name} · ${sys.realName}`, 3200);
    });
  },
});
function refreshDexCards() {
  const saved = savedProgress();
  ui.setDexCards(
    SYSTEMS.map(
      (sys) => `<div class="eh-dex-card ${saved >= sys.unlockAfter ? '' : 'locked'}">
        <h3>${saved >= sys.unlockAfter ? sys.name : '？？？ · 待解锁'}</h3>
        <div class="row"><b>质量</b> ${sys.massSolar >= 1e6 ? (sys.massSolar / 1e6).toFixed(2) + ' 百万' : sys.massSolar} M☉ &nbsp;·&nbsp; <b>史瓦西半径</b> ${sys.rsKm >= 1e9 ? (sys.rsKm / 1e9).toFixed(1) + ' 亿 km' : sys.rsKm + ' km'} &nbsp;·&nbsp; <b>距离</b> ${sys.id === 'sgrA' ? '2.6 万' : sys.id === 'cygX1' ? '7,200' : '5,500 万'} 光年</div>
        <div class="row">${saved >= sys.unlockAfter ? sys.fact : '完成巡礼前序任务后解锁档案。'}</div>
      </div>`,
    )
    .join(''),
  );
}
showMenuMode();

// —— 键盘动作 ——
const CAM_NAMES = ['追尾', '座舱', '自由'];
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    if (state.mode === 'flight') enterPhotoMode();
    else if (state.mode === 'photo') exitPhotoMode();
    return;
  }
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
  } else if (e.code === 'KeyM') {
    toggleStarMap();
  } else if (e.code === 'KeyE') {
    flags.add('eht');
    toggleEhtView();
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
  get frames() {
    return frame;
  },
  get compDist() {
    return companion ? ship.pos.distanceTo(companion.pos) : -1;
  },
  get compExists() {
    return !!companion;
  },
  get derelictPos() {
    return derelict ? derelict.pos.toArray() : null;
  },
  launchMission: (i: number) => launchMission(i),
  startFree: () => launchFreeFlight(),
  // 手动驱动模拟（自动化测试用，与 rAF 兼容）
  step: (dt: number) => stepSimulation(Math.min(dt, 1.0)),
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
function stepSimulation(dt: number) {
  if (state.mode !== 'flight') return;
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
  if (finaleMode === 'fall') thrustDir.set(0, 0, 0);
  if (finaleMode === 'escape' && finaleEscapeT < 3) {
    // 脚本化返航点火：PW 势在近场所需的 Δv 超光速，用持续推力保证脱离
    finaleEscapeT += dt * state.warp;
    ship.vel.addScaledVector(tmpDir.copy(ship.pos).normalize(), 0.3 * dt * state.warp);
    ship.throttle = 1;
    shipVisual.setThrottle(1);
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
    if (finaleMode === 'none') updateHeat(dtSim); // 终章 scripted 航段免于过热

    // 坠洞 / 过热
    if (res.crashed && finaleMode !== 'fall') {
      ship.alive = false;
      if (missionIndex >= 0) failMission('飞船越过事件视界，信号终止于无限红移。');
      else hud.toast('你越过了事件视界 — 按 R 重生', 8000);
    } else if (ship.heat >= 100 && finaleMode !== 'fall') {
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
    updateDerelict(dt * state.warp);
    updateCompanion(dt * state.warp);
    updateFinale();
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

}

let lastTickAt = Date.now();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  lastTickAt = Date.now();

  if (state.mode === 'photo') {
    controls.update();
    bhUniforms.uTime.value += dt;
    renderPipeline();
    return;
  }

  stepSimulation(dt);

  shipVisual.group.position.copy(ship.pos);
  shipVisual.group.quaternion.copy(ship.quat);

  updateCamera(dt);

  if (frame % 3 === 0) predictor.update(ship.pos, ship.vel);

  if (starMapOn) {
    const p = new THREE.Vector3();
    for (let i = 0; i < labelPool.length; i++) {
      const el = labelPool[i];
      p.copy(labelDirs[i]).applyMatrix3(bhUniforms.uSkyRot.value).multiplyScalar(100);
      const proj = p.project(camera);
      const behind = proj.z > 1;
      const x = (proj.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-proj.y * 0.5 + 0.5) * window.innerHeight;
      const off = behind || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight;
      el.style.display = off ? 'none' : '';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }

  if (state.hudVisible) hud.update(state, ship, camera);

  bhUniforms.uTime.value += dt;
  bhUniforms.uBeaming.value = params.beaming;
  renderPipeline();
}

// —— 摄影模式 ——
const photoEls: HTMLElement[] = [];
function photoButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'appearance:none;background:rgba(20,16,12,0.7);border:1px solid rgba(255,200,140,0.5);border-radius:3px;color:#ffe0b9;font-size:13px;letter-spacing:0.25em;padding:8px 20px;cursor:pointer;pointer-events:auto;';
  b.addEventListener('click', onClick);
  return b;
}

function enterPhotoMode() {
  state.mode = 'photo';
  state.paused = true;
  hud.setVisible(false);
  markers.setVisible(false);
  controls.enabled = true;
  controls.target.copy(ship.pos);
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.quat);
  camera.position.copy(ship.pos).addScaledVector(dir, -4).add(new THREE.Vector3(0, 1.2, 0));

  const top = document.createElement('div');
  top.style.cssText = 'position:fixed;top:0;left:0;right:0;height:9vh;background:#000;z-index:25;';
  const bottom = document.createElement('div');
  bottom.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:9vh;background:#000;z-index:25;';
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;bottom:11vh;left:50%;transform:translateX(-50%);display:flex;gap:12px;z-index:26;';
  bar.append(photoButton('◉ 拍摄', takePhoto), photoButton('退出摄影模式 (P)', exitPhotoMode));
  document.body.append(top, bottom, bar);
  photoEls.push(top, bottom, bar);
}

function exitPhotoMode() {
  state.mode = 'flight';
  state.paused = false;
  hud.setVisible(state.hudVisible);
  markers.setVisible(missionIndex >= 0);
  controls.enabled = state.cameraMode === 2;
  for (const el of photoEls) el.remove();
  photoEls.length = 0;
}

function takePhoto() {
  renderPipeline();
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `event-horizon-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    hud.toast('照片已保存', 2000);
    hud.setVisible(false);
  });
}

function renderPipeline() {
  camera.updateMatrixWorld();
  bhUniforms.uCamWorld.value.copy(camera.matrixWorld);
  bhUniforms.uCamPos.value.copy(camera.position);
  bhUniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
  renderer.setRenderTarget(rt);
  renderer.render(bhScene, orthoCam);
  renderer.setRenderTarget(null);
  composer.render();
}

// 页面被浏览器节流（后台标签/最小化）时，用定时器兜底驱动模拟
let simAcc = 0;
setInterval(() => {
  if (Date.now() - lastTickAt > 300) {
    simAcc += 1 / 60;
    let steps = 0;
    while (simAcc >= 1 / 60 && steps < 30) {
      stepSimulation(1 / 60);
      simAcc -= 1 / 60;
      steps++;
    }
  }
}, 1000 / 60);

renderPipeline();
tick();
