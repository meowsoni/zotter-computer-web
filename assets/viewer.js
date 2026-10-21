import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

const holder = document.getElementById('viewer');
const hint = document.getElementById('viewer-hint');

const palette = {
  '9e917f': '#d9c9a9',
  '6c5735': '#b99054',
  '937a21': '#c3a750',
  '534747': '#55656a',
  '8d8d8d': '#b4bea2',
};

const paintShader = /* glsl */ `
  varying vec3 vPaintPosition;

  float paintHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float paintNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(paintHash(i), paintHash(i + vec3(1,0,0)), f.x),
          mix(paintHash(i + vec3(0,1,0)), paintHash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(paintHash(i + vec3(0,0,1)), paintHash(i + vec3(1,0,1)), f.x),
          mix(paintHash(i + vec3(0,1,1)), paintHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  vec3 getGradientIrradiance(vec3 n, vec3 lightDirection) {
    float d = dot(n, lightDirection);
    float w = max(0.045, fwidth(d));
    float mid = smoothstep(-0.12 - w, -0.12 + w, d);
    float lit = smoothstep(0.50 - w, 0.50 + w, d);
    return vec3(0.06 + 0.49 * mid + 0.45 * lit);
  }
`;

async function start() {
  hint.textContent = 'Loading model…';

  const scene = new THREE.Scene();
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue('--bg').trim();
  scene.background = new THREE.Color(bg || '#f3eddf');

  const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
  const target = new THREE.Vector3();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  holder.appendChild(renderer.domElement);

  const effect = new OutlineEffect(renderer, {
    defaultColor: new THREE.Color('#554d46').toArray(),
    defaultThickness: 0.00085,
    defaultAlpha: 0.65,
  });

  const key = new THREE.DirectionalLight('#fff0d8', 2.05);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 2;
  key.shadow.bias = -0.00015;
  key.shadow.intensity = 0.85;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight('#c9d9ed', '#d7c2a3', 1.1));

  let radius = 0;
  function render() { effect.render(scene, camera); }

  function resize() {
    const width = holder.clientWidth;
    const height = holder.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (radius) {
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const distance = 0.95 * radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2);
      const direction = camera.position.clone().sub(target).normalize();
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
    }
    render();
  }
  new ResizeObserver(resize).observe(holder);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const model = (await loader.loadAsync('/assets/zotter.glb')).scene;
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  target.copy(bounds.getCenter(new THREE.Vector3()));
  radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;

  const scale = 1 / Math.max(size.x, size.y, size.z);
  const paintTransform = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-target.x, -target.y, -target.z));

  function makeToon(original, paintMatrix) {
    const color = original.color?.clone() ?? new THREE.Color('white');
    const replacement = palette[color.getHexString()];
    if (replacement) color.set(replacement);

    const hsl = {};
    color.getHSL(hsl, THREE.SRGBColorSpace);
    color.setHSL(
      hsl.h, hsl.s * 0.82,
      THREE.MathUtils.lerp(hsl.l, 0.68, 0.08),
      THREE.SRGBColorSpace
    );

    const material = new THREE.MeshToonMaterial({
      color,
      map: original.map || null,
      alphaMap: original.alphaMap || null,
      transparent: original.transparent,
      opacity: original.opacity,
      alphaTest: original.alphaTest,
      side: original.side,
      depthWrite: original.depthWrite,
      vertexColors: original.vertexColors,
      emissive: original.emissive?.clone() ?? new THREE.Color(0),
      emissiveMap: original.emissiveMap || null,
      emissiveIntensity: original.emissiveIntensity ?? 1,
      dithering: true,
    });

    material.onBeforeCompile = shader => {
      shader.uniforms.uPaintMatrix = { value: paintMatrix };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          uniform mat4 uPaintMatrix;
          varying vec3 vPaintPosition;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vPaintPosition = (uPaintMatrix * vec4(position, 1.0)).xyz;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <gradientmap_pars_fragment>', paintShader)
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          float wash = 0.75 * paintNoise(vPaintPosition * 7.0)
                     + 0.25 * paintNoise(vPaintPosition * 23.0);
          diffuseColor.rgb *= 1.0 + 0.035 * (wash * 2.0 - 1.0);
        `);
    };

    material.customProgramCacheKey = () => 'zotter-painted';
    material.userData.outlineParameters = {
      visible: !original.transparent,
      alpha: 0.65,
    };
    return material;
  }

  const oldMaterials = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const paintMatrix = paintTransform.clone().multiply(object.matrixWorld);
    const convert = original => {
      oldMaterials.add(original);
      return makeToon(original, paintMatrix);
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(convert)
      : convert(object.material);
  });
  oldMaterials.forEach(material => material.dispose());

  key.position.copy(target).addScaledVector(
    new THREE.Vector3(-1.2, 1.8, 1).normalize(), radius * 4
  );
  key.target.position.copy(target);
  const shadowCamera = key.shadow.camera;
  shadowCamera.left = shadowCamera.bottom = -radius * 1.15;
  shadowCamera.right = shadowCamera.top = radius * 1.15;
  shadowCamera.near = radius * 0.1;
  shadowCamera.far = radius * 7;
  shadowCamera.updateProjectionMatrix();
  key.shadow.normalBias = radius * 0.001;

  camera.position.copy(target).add(new THREE.Vector3(1, 1, 1).normalize());
  resize();
  hint.textContent = '';

  let velX = 0, velY = 0;
  let frame = 0;

  function tick() {
    frame = 0;
    model.rotation.y += velY;
    model.rotation.x += velX;
    velX = Math.abs(velX) < 1e-5 ? 0 : velX * 0.92;
    velY = Math.abs(velY) < 1e-5 ? 0 : velY * 0.92;
    render();
    if (velX || velY) requestRender();
  }

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function rotateBy(dx, dy, sensitivity) {
    model.rotation.y += dx * sensitivity;
    model.rotation.x += dy * sensitivity;
    velY += dx * sensitivity * 0.2;
    velX += dy * sensitivity * 0.2;
    requestRender();
  }

  const canvas = renderer.domElement;
  let touch = null;
  canvas.addEventListener('touchstart', e => {
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!touch) return;
    const t = e.touches[0];
    rotateBy(t.clientX - touch.x, t.clientY - touch.y, 0.01);
    touch = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  const endTouch = () => { touch = null; };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    rotateBy(e.clientX - mouse.x, e.clientY - mouse.y, 0.002);
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
}

start().catch(error => {
  hint.textContent = 'Could not display the model.';
  console.error('Zotter 3D viewer:', error);
});
