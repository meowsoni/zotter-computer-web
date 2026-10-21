import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const holder = document.getElementById('viewer');
const hint = document.getElementById('viewer-hint');

async function start() {
  hint.textContent = 'Loading model…';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());

  const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
  const target = new THREE.Vector3();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  holder.appendChild(renderer.domElement);

  const lights = [
    new THREE.DirectionalLight(0xffffff, 2.2),
    new THREE.DirectionalLight(0xffffff, 1.4),
    new THREE.DirectionalLight(0xffffff, 1.0),
  ];
  lights[0].position.set(-4, 8, 6);
  lights[1].position.set(5, 3, -4);
  lights[2].position.set(-2, -2, 5);
  lights.forEach(light => scene.add(light));

  const levels = [55, 120, 195, 255];
  const pixels = new Uint8Array(levels.flatMap(v => [v, v, v, 255]));
  const gradient = new THREE.DataTexture(pixels, levels.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;

  let radius = 0;
  function render() { renderer.render(scene, camera); }

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

  const makeToon = original => new THREE.MeshToonMaterial({
    color: original.color ? original.color.clone() : new THREE.Color(0xffffff),
    map: original.map || null,
    gradientMap: gradient,
    transparent: original.transparent,
    opacity: original.opacity,
    alphaTest: original.alphaTest,
    side: original.side,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
  model.traverse(object => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(makeToon)
      : makeToon(object.material);
    object.add(new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 15), edgeMaterial));
  });
  scene.add(model);

  const bounds = new THREE.Box3().setFromObject(model);
  target.copy(bounds.getCenter(new THREE.Vector3()));
  radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  camera.position.copy(target).add(new THREE.Vector3(0.7, 0.5, 1).normalize());
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
