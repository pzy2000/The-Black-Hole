import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { fullscreenVertex, blackholeFragment, compositeFragment } from './shaders';

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
  autoOrbit: true,
};

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

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
camera.position.set(0.0, 2.6, 15.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = -0.5;
controls.minDistance = 3.5;
controls.maxDistance = 45;

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
const bhScene = new THREE.Scene();
const bhQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: bhUniforms,
    vertexShader: fullscreenVertex,
    fragmentShader: blackholeFragment,
    depthTest: false,
    depthWrite: false,
  }),
);
bhQuad.frustumCulled = false;
bhScene.add(bhQuad);

// —— 合成 + HDR 泛光 ——
const compUniforms = { uTex: { value: rt.texture } };
const compScene = new THREE.Scene();
const compQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: compUniforms,
    vertexShader: fullscreenVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
  }),
);
compQuad.frustumCulled = false;
compScene.add(compQuad);

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType }),
);
composer.addPass(new RenderPass(compScene, orthoCam));
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

// —— UI ——
const btnOrbit = document.getElementById('btnOrbit') as HTMLButtonElement;
const btnQuality = document.getElementById('btnQuality') as HTMLButtonElement;
const btnBeam = document.getElementById('btnBeam') as HTMLButtonElement;

let idleTimer: ReturnType<typeof setTimeout> | undefined;
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
});
controls.addEventListener('end', () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (params.autoOrbit) controls.autoRotate = true;
  }, 3000);
});

btnOrbit.addEventListener('click', () => {
  params.autoOrbit = !params.autoOrbit;
  controls.autoRotate = params.autoOrbit;
  btnOrbit.classList.toggle('on', params.autoOrbit);
});

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

// —— 主循环 ——
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  controls.update();
  camera.updateMatrixWorld();
  bhUniforms.uCamWorld.value.copy(camera.matrixWorld);
  bhUniforms.uCamPos.value.copy(camera.position);
  bhUniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
  bhUniforms.uTime.value = clock.getElapsedTime();
  bhUniforms.uBeaming.value = params.beaming;

  renderer.setRenderTarget(rt);
  renderer.render(bhScene, orthoCam);
  renderer.setRenderTarget(null);
  composer.render();
}
tick();
