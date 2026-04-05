import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** 
 * GAME STATE
 */
let gameRunning = false;
let score = 0, boost = 100, t = 0;
let speed = 0, shipAngle = Math.PI / 2, targetAngle = Math.PI / 2, shipRotationZ = 0;
let lastHitTime = 0;

// Progression & Power-up State
let diamondsCollected = 0;
let scoreMultiplier = 1;
let infiniteBoostTimer = 0; // in seconds
let invincibilityTimer = 0; // in seconds

const MAX_SPEED = 0.0008;
const BOOST_SPEED = 0.0015;
const ACCEL = 0.000015;
const FRICTION = 0.98;
const TUBE_RADIUS = 16;
const HITBOX_RADIUS = 3.5;
const DIAMOND_HITBOX = 8.5; // Much bigger hitbox for diamonds

/**
 * THREE.JS SCENE SETUP
 */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x020008, 0.0035);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
scene.add(camera);

const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.6, 0.2);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambLight);
const pointLight = new THREE.PointLight(0x00dcff, 3, 100);
scene.add(pointLight);

/**
 * ENVIRONMENT
 */
const gridHelper = new THREE.GridHelper(4000, 150, 0xff00aa, 0x220044);
gridHelper.position.y = -150;
scene.add(gridHelper);

const starsGeo = new THREE.BufferGeometry();
const starsPos = new Float32Array(3000 * 3);
for(let i=0; i<3000*3; i++) starsPos[i] = (Math.random() - 0.5) * 2000;
starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
const starField = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0x00dcff, size: 1.5, transparent: true, opacity: 0.6 }));
scene.add(starField);

/**
 * TRACK GENERATION
 */
const curvePoints = [];
for (let i = 0; i < 200; i++) {
  const angle = (i / 200) * Math.PI * 2;
  const x = Math.sin(angle) * 450 + Math.sin(angle * 3) * 80;
  const y = Math.cos(angle * 2) * 80 + Math.sin(angle * 5) * 30;
  const z = Math.cos(angle) * 450 + Math.cos(angle * 3) * 80;
  curvePoints.push(new THREE.Vector3(x, y, z));
}
const spline = new THREE.CatmullRomCurve3(curvePoints, true);
const tubeSegments = 1200;
const frames = spline.computeFrenetFrames(tubeSegments, true);

const trackGeo = new THREE.TubeGeometry(spline, tubeSegments, 18, 20, true);
const canvas = document.createElement('canvas');
canvas.width = 512; canvas.height = 512;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#080808'; ctx.fillRect(0,0,512,512);
ctx.shadowBlur = 15; ctx.shadowColor = '#00dcff'; ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 8;
ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(512, 10); ctx.stroke();
const trackTex = new THREE.CanvasTexture(canvas);
trackTex.wrapS = THREE.RepeatWrapping; trackTex.wrapT = THREE.RepeatWrapping;
trackTex.repeat.set(400, 2); 
const trackMesh = new THREE.Mesh(trackGeo, new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.4, metalness: 0.1, side: THREE.BackSide }));
scene.add(trackMesh);

/**
 * OBSTACLE & COLLECTIBLE SYSTEM
 */
const obstacles = [];
const collectibles = [];

function makeObstacleMesh() {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff1111 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 16), coreMat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.25, 8, 32), new THREE.MeshBasicMaterial({ color: 0xff4400 }));
  ring.userData.isRing = true;
  group.add(core, ring);
  return group;
}

function makeDiamondMesh(color) {
  const group = new THREE.Group();
  const geo = new THREE.OctahedronGeometry(2.2, 0);
  const mat = new THREE.MeshStandardMaterial({ color: color, emissive: color, metalness: 0.8, roughness: 0.2 });
  group.add(new THREE.Mesh(geo, mat));
  return group;
}

// Generate items
for (let i = 0; i < 1; i += 0.018) { // Frequency slightly decreased (0.015 -> 0.018)
  const angle = Math.random() * Math.PI * 2;
  const idx = Math.floor(i * tubeSegments);
  const pos = spline.getPointAt(i);
  const offset = new THREE.Vector3().copy(frames.normals[idx]).multiplyScalar(Math.cos(angle)).addScaledVector(frames.binormals[idx], Math.sin(angle));

  if (Math.random() > 0.2) { // 80% Mines
    const mine = makeObstacleMesh();
    mine.position.copy(pos).add(offset.multiplyScalar(TUBE_RADIUS));
    mine.lookAt(pos);
    scene.add(mine);
    obstacles.push({ mesh: mine, t: i });
  } else { // 20% Diamonds
    let type = 'yellow';
    let color = 0xffff00;
    const rand = Math.random();
    if (rand < 0.05) { type = 'purple'; color = 0xbf00ff; }
    else if (rand < 0.10) { type = 'green'; color = 0x00ff00; }

    const diamond = makeDiamondMesh(color);
    diamond.position.copy(pos).add(offset.multiplyScalar(TUBE_RADIUS - 1));
    scene.add(diamond);
    collectibles.push({ mesh: diamond, t: i, type: type });
  }
}

/**
 * THE SHIP 
 */
const shipGroup = new THREE.Group();
const hullMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
shipGroup.add(new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 16).rotateX(Math.PI / 2), hullMat));
const engineMat = new THREE.MeshBasicMaterial({ color: 0xff00aa });
const eng1 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.8, 16).rotateX(Math.PI / 2), engineMat);
eng1.position.set(-0.6, 0, 1.8);
const eng2 = eng1.clone();
eng2.position.set(0.6, 0, 1.8);
shipGroup.add(eng1, eng2);
scene.add(shipGroup);

const linesGroup = new THREE.Group();
const lineMat = new THREE.MeshBasicMaterial({ color: 0x00dcff, transparent: true, opacity: 0.4 });
for(let i=0; i<150; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, Math.random() * 20 + 10), lineMat);
  mesh.position.set((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, -Math.random() * 150 - 20);
  linesGroup.add(mesh);
}
camera.add(linesGroup);

/**
 * INPUTS & ACTIONS
 */
const keys = {};
window.onkeydown = (e) => keys[e.code] = true;
window.onkeyup = (e) => keys[e.code] = false;
window.startGame = () => { document.getElementById('overlay').classList.add('hidden'); gameRunning = true; };

function triggerHitFlash() {
  const flash = document.getElementById('hit-flash');
  if(!flash) return;
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 120);
}

/**
 * GAME LOOP
 */
function update() {
  if (!gameRunning) return;
  const now = Date.now();
  const deltaTime = 1/60; // Approximate

  // Power-up Timers
  if (infiniteBoostTimer > 0) { infiniteBoostTimer -= deltaTime; boost = 100; }
  if (invincibilityTimer > 0) invincibilityTimer -= deltaTime;

  // Movement
  if (keys['KeyW'] || keys['ArrowUp']) speed += ACCEL;
  else if (keys['KeyS'] || keys['ArrowDown']) speed -= ACCEL * 2;
  else speed *= FRICTION;

  let isManualBoosting = keys['Space'] && boost > 0;
  let currentMax = (isManualBoosting || infiniteBoostTimer > 0) ? BOOST_SPEED : MAX_SPEED;

  if (isManualBoosting && infiniteBoostTimer <= 0) {
    boost -= 0.6;
    camera.fov += (110 - camera.fov) * 0.1;
  } else {
    boost = Math.min(100, boost + 0.1);
    camera.fov += (75 - camera.fov) * 0.1;
  }
  camera.updateProjectionMatrix();

  speed = Math.max(0, Math.min(speed, currentMax));
  t = (t + speed) % 1;

  // Steering
  if (keys['KeyA'] || keys['ArrowLeft']) targetAngle += 0.05;
  if (keys['KeyD'] || keys['ArrowRight']) targetAngle -= 0.05;
  shipAngle += (targetAngle - shipAngle) * 0.15;
  shipRotationZ = (targetAngle - shipAngle) * 2.5;

  // Transform
  const idx = Math.floor(t * tubeSegments);
  const pos = spline.getPointAt(t);
  const tangent = frames.tangents[idx];
  const surfaceDir = new THREE.Vector3().copy(frames.normals[idx]).multiplyScalar(Math.cos(shipAngle)).addScaledVector(frames.binormals[idx], Math.sin(shipAngle));

  shipGroup.position.copy(pos).add(surfaceDir.clone().multiplyScalar(TUBE_RADIUS - 1.2));
  const lookAtPos = spline.getPointAt((t + 0.01) % 1);
  shipGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(shipGroup.position, lookAtPos, surfaceDir));
  shipGroup.rotateZ(shipRotationZ);

  // MINE COLLISION
  if (invincibilityTimer <= 0) {
    obstacles.forEach(obs => {
      if (Math.abs(t - obs.t) < 0.02 && shipGroup.position.distanceTo(obs.mesh.position) < HITBOX_RADIUS && now - lastHitTime > 1000) {
        speed *= 0.2; score = Math.max(0, score - 500); lastHitTime = now; triggerHitFlash();
      }
    });
  }

  // DIAMOND COLLECTION
  collectibles.forEach((diamond, index) => {
    if (Math.abs(t - diamond.t) < 0.03) {
      if (shipGroup.position.distanceTo(diamond.mesh.position) < DIAMOND_HITBOX) {
        scene.remove(diamond.mesh);
        collectibles.splice(index, 1);
        if (diamond.type === 'yellow') { diamondsCollected++; scoreMultiplier = 1 + Math.floor(diamondsCollected / 4); }
        else if (diamond.type === 'purple') { infiniteBoostTimer = 10; }
        else if (diamond.type === 'green') { invincibilityTimer = 10; }
      }
    }
  });

  // Color Palette Logic
  let pColor = 0x00dcff; // Pointlight/Lines
  let eColor = 0xff00aa; // Engine
  
  if (infiniteBoostTimer > 0 && invincibilityTimer > 0) {
      // AURORA BOREALIS EFFECT (Cycle through spectrum)
      const hue = (now * 0.001) % 1;
      eColor = new THREE.Color().setHSL(hue, 1, 0.5).getHex();
      pColor = new THREE.Color().setHSL((hue + 0.5) % 1, 1, 0.5).getHex();
  } else if (invincibilityTimer > 0) {
      eColor = pColor = 0x00ff00;
  } else if (infiniteBoostTimer > 0) {
      eColor = pColor = 0xbf00ff;
  } else if (isManualBoosting) {
      eColor = pColor = 0xffaa00;
  }

  engineMat.color.setHex(eColor);
  lineMat.color.setHex(pColor);
  pointLight.color.setHex(pColor);
  pointLight.intensity = (isManualBoosting || infiniteBoostTimer > 0) ? 6 : 3;

  // Ship Flicker on Hit
  shipGroup.visible = (now - lastHitTime < 1000) ? (now % 100 > 50) : true;

  // Camera Follow
  const camOffset = surfaceDir.clone().multiplyScalar(-6).add(tangent.clone().multiplyScalar(-12));
  camera.position.lerp(shipGroup.position.clone().add(camOffset), 0.1);
  camera.lookAt(shipGroup.position.clone().add(tangent.clone().multiplyScalar(15)));

  // VFX
  linesGroup.visible = (speed * 300000) >= 240;
  if (linesGroup.visible) {
    linesGroup.children.forEach(line => {
      line.position.z += (speed * 12000) * ((isManualBoosting || infiniteBoostTimer > 0) ? 1.5 : 1);
      if (line.position.z > 5) { line.position.z = -100 - Math.random() * 80; line.position.x = (Math.random()-0.5)*80; line.position.y = (Math.random()-0.5)*50; }
    });
  }

  obstacles.forEach(obs => { 
    obs.mesh.children.forEach(c => { if (c.userData.isRing) c.rotation.y += 0.05; }); 
  });
  collectibles.forEach(d => { d.mesh.rotation.y += 0.04; d.mesh.rotation.x += 0.02; });

  pointLight.position.copy(shipGroup.position).add(surfaceDir.clone().multiplyScalar(-3));
  starField.rotation.y = t * 2;

  // UI
  document.getElementById('speed-val').innerText = Math.floor(speed * 300000).toString().padStart(3, '0');
  document.getElementById('boost-fill').style.width = boost + '%';
  score += Math.floor(speed * 2000 * scoreMultiplier);
  document.getElementById('score-val').innerText = `${score.toLocaleString()} (x${scoreMultiplier})`;
}

function animate() { requestAnimationFrame(animate); update(); composer.render(); }
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); });
animate();
