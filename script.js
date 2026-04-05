import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** 
 * GAME STATE
 */
let gameRunning = false;
let score = 0, boost = 100, t = 0;
let speed = 0, lateralOffset = 0, targetLateralOffset = 0, shipRotationZ = 0;

const MAX_SPEED = 0.0008;
const BOOST_SPEED = 0.0015;
const ACCEL = 0.000015;
const FRICTION = 0.98;

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

// Post-Processing
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.6, 0.2);
const composer = new EffectComposer(renderer);
composer.addPass(renderScene);
composer.addPass(bloomPass);

// Lighting
const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambLight);
const pointLight = new THREE.PointLight(0x00dcff, 3, 100);
scene.add(pointLight);

/**
 * ENVIRONMENT
 */
// Synthwave Grid Floor
const gridHelper = new THREE.GridHelper(4000, 150, 0xff00aa, 0x220044);
gridHelper.position.y = -150;
scene.add(gridHelper);

// Starfield / Data Particles
const starsGeo = new THREE.BufferGeometry();
const starsPos = new Float32Array(3000 * 3);
for(let i=0; i<3000*3; i++) {
  starsPos[i] = (Math.random() - 0.5) * 2000;
}
starsGeo.setAttribute('position', new THREE.BufferAttribute(starsPos, 3));
const starsMat = new THREE.PointsMaterial({ color: 0x00dcff, size: 1.5, transparent: true, opacity: 0.6 });
const starField = new THREE.Points(starsGeo, starsMat);
scene.add(starField);

/**
 * TRACK GENERATION
 */
const curvePoints = [];
for (let i = 0; i < 400; i++) {
  const angle = (i / 400) * Math.PI * 2;
  
  // Drift-Esque sweeping arcs using high amplitude, low-frequency waves
  const x = Math.sin(angle) * 800 + Math.sin(angle * 2) * 500;
  const y = Math.cos(angle * 2) * 200 + Math.sin(angle) * 150;
  const z = Math.cos(angle) * 800 - Math.cos(angle * 2) * 500;
  
  curvePoints.push(new THREE.Vector3(x, y, z));
}
const spline = new THREE.CatmullRomCurve3(curvePoints, true);

// Main Dark Asphalt Track
// Increased segments (2400) to keep the sweeping curves ultra smooth
const trackGeo = new THREE.TubeGeometry(spline, 3400, 18, 20, true);
const canvas = document.createElement('canvas');
canvas.width = 512; canvas.height = 512;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#080808'; 
ctx.fillRect(0,0,512,512);
ctx.strokeStyle = '#222';
ctx.lineWidth = 2;
ctx.strokeRect(0,0,512,512);

// Glowing Neon Edge Lines
ctx.shadowBlur = 15; ctx.shadowColor = '#00dcff'; ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 8;
ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(512, 10); ctx.stroke();
ctx.shadowColor = '#ff00aa'; ctx.strokeStyle = '#ff00aa'; 
ctx.beginPath(); ctx.moveTo(0, 502); ctx.lineTo(512, 502); ctx.stroke();

const trackTex = new THREE.CanvasTexture(canvas);
trackTex.wrapS = THREE.RepeatWrapping; trackTex.wrapT = THREE.RepeatWrapping;
trackTex.repeat.set(800, 2); // Scaled texture repeats to match larger track

const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
const trackMesh = new THREE.Mesh(trackGeo, trackMat);
scene.add(trackMesh);

// Hovering Neon Rings 
const ringGeo = new THREE.RingGeometry(25, 26.5, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xff00aa, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
for (let i = 0; i < 1; i += 0.006) { // Adjusted density to fit the longer track perfectly
  const pos = spline.getPointAt(i);
  const tangent = spline.getTangentAt(i);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos);
  ring.lookAt(pos.clone().add(tangent));
  if(Math.random() > 0.5) ring.material = new THREE.MeshBasicMaterial({ color: 0x00dcff, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  scene.add(ring);
}

/**
 * THE SHIP 
 */
const shipGroup = new THREE.Group();

// Central Hull
const hullMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
const hullGeo = new THREE.ConeGeometry(0.8, 4, 16);
hullGeo.rotateX(Math.PI / 2);
const hull = new THREE.Mesh(hullGeo, hullMat);
shipGroup.add(hull);

// Cockpit Canopy
const glassMat = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 1, roughness: 0, emissive: 0x110033 });
const glassGeo = new THREE.SphereGeometry(0.6, 16, 16);
const glass = new THREE.Mesh(glassGeo, glassMat);
glass.scale.set(0.8, 0.6, 2);
glass.position.set(0, 0.3, -0.2);
shipGroup.add(glass);

// Swept Wings
const wingGeo = new THREE.ConeGeometry(2.5, 3, 3);
wingGeo.rotateX(Math.PI / 2);
const wings = new THREE.Mesh(wingGeo, hullMat);
wings.scale.set(2, 0.1, 0.8);
wings.position.set(0, -0.2, 0.8);
shipGroup.add(wings);

// Neon Accents on Wings
const accentGeo = new THREE.BoxGeometry(9.5, 0.12, 0.2);
const accentMat = new THREE.MeshBasicMaterial({ color: 0x00dcff });
const accent = new THREE.Mesh(accentGeo, accentMat);
accent.position.set(0, -0.2, 1.8);
shipGroup.add(accent);

// Dual Engines
const engineMat = new THREE.MeshBasicMaterial({ color: 0xff00aa });
const engGeo = new THREE.CylinderGeometry(0.25, 0.4, 0.8, 16);
engGeo.rotateX(Math.PI / 2);
const eng1 = new THREE.Mesh(engGeo, engineMat);
eng1.position.set(-0.6, 0, 1.8);
const eng2 = eng1.clone();
eng2.position.set(0.6, 0, 1.8);
shipGroup.add(eng1, eng2);

scene.add(shipGroup);

// Dynamic Speed Lines 
const linesGroup = new THREE.Group();
const lineMat = new THREE.MeshBasicMaterial({ color: 0x00dcff, transparent: true, opacity: 0.4 });
for(let i=0; i<150; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, Math.random() * 20 + 10), lineMat);
  mesh.position.set((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, -Math.random() * 150 - 20);
  linesGroup.add(mesh);
}
camera.add(linesGroup);

/**
 * INPUTS
 */
const keys = {};
window.onkeydown = (e) => keys[e.code] = true;
window.onkeyup = (e) => keys[e.code] = false;

// Attach globally so the index.html inline click handler can access it
window.startGame = function() {
  document.getElementById('overlay').classList.add('hidden');
  gameRunning = true;
}

/**
 * GAME LOOP
 */
function update() {
  if (!gameRunning) return;

  // Accel/Brake
  if (keys['KeyW'] || keys['ArrowUp']) speed += ACCEL;
  else if (keys['KeyS'] || keys['ArrowDown']) speed -= ACCEL * 2;
  else speed *= FRICTION;

  // Boost Logic
  let currentMax = MAX_SPEED;
  let isBoosting = false;

  if (keys['Space'] && boost > 0) {
    currentMax = BOOST_SPEED;
    boost -= 0.6;
    isBoosting = true;
    camera.fov += (110 - camera.fov) * 0.1; 
    
    // Smooth Synthwave Orange/Gold for Boost
    engineMat.color.setHex(0xffaa00); 
    lineMat.color.setHex(0xffaa00);
    pointLight.color.setHex(0xffaa00);
    pointLight.intensity = 6; 
  } else {
    boost = Math.min(100, boost + 0.1);
    camera.fov += (75 - camera.fov) * 0.1;
    
    // Normal Colors
    engineMat.color.setHex(0xff00aa);
    lineMat.color.setHex(0x00dcff);
    pointLight.color.setHex(0x00dcff);
    pointLight.intensity = 3;
  }
  camera.updateProjectionMatrix();

  speed = Math.max(0, Math.min(speed, currentMax));
  t = (t + speed) % 1;

  // Steering: A/Left moves left (-offset), D/Right moves right (+offset)
  if (keys['KeyA'] || keys['ArrowLeft']) targetLateralOffset = -8;
  else if (keys['KeyD'] || keys['ArrowRight']) targetLateralOffset = 8;
  else targetLateralOffset = 0;

  lateralOffset += (targetLateralOffset - lateralOffset) * 0.08;
  shipRotationZ += (-lateralOffset * 0.15 - shipRotationZ) * 0.15; // Banking animation

  // Ship Placement
  const pos = spline.getPointAt(t);
  const tangent = spline.getTangentAt(t);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(tangent, up).normalize(); 
  const refinedUp = new THREE.Vector3().crossVectors(side, tangent).normalize();

  shipGroup.position.copy(pos);
  shipGroup.position.add(side.clone().multiplyScalar(lateralOffset));
  shipGroup.position.add(refinedUp.clone().multiplyScalar(2.5)); // Slightly higher hover
  
  // Smooth Orientation Lookahead
  const lookAtT = (t + 0.01) % 1;
  const lookAtPos = spline.getPointAt(lookAtT);
  const lookAtTangent = spline.getTangentAt(lookAtT);
  const lookAtSide = new THREE.Vector3().crossVectors(lookAtTangent, up).normalize();
  const lookAtRefinedUp = new THREE.Vector3().crossVectors(lookAtSide, lookAtTangent).normalize();
  
  lookAtPos.add(lookAtSide.clone().multiplyScalar(lateralOffset));
  lookAtPos.add(lookAtRefinedUp.clone().multiplyScalar(2.5));

  const matrix = new THREE.Matrix4().lookAt(shipGroup.position, lookAtPos, refinedUp);
  const baseQuat = new THREE.Quaternion().setFromRotationMatrix(matrix);
  
  shipGroup.quaternion.copy(baseQuat);
  shipGroup.rotateZ(shipRotationZ); // Apply bank roll locally

  // Camera Follow Rig
  const camOffset = new THREE.Vector3(0, 5, 16); 
  camOffset.applyQuaternion(baseQuat);
  const targetCamPos = shipGroup.position.clone().add(camOffset);
  camera.position.lerp(targetCamPos, 0.3);
  
  const camLookOffset = new THREE.Vector3(0, 1, -20);
  camLookOffset.applyQuaternion(baseQuat);
  const targetCamLook = shipGroup.position.clone().add(camLookOffset);
  camera.lookAt(targetCamLook);

  // Speed Lines & Engine Pulse
  linesGroup.children.forEach(line => {
    line.position.z += (speed * 12000) * (isBoosting ? 1.5 : 1);
    if (line.position.z > 5) {
      line.position.z = -100 - Math.random() * 80;
      line.position.x = (Math.random() - 0.5) * 80;
      line.position.y = (Math.random() - 0.5) * 50;
    }
  });

  const enginePulse = 1 + Math.random() * 0.3 + (speed / MAX_SPEED);
  eng1.scale.set(1, enginePulse, 1);
  eng2.scale.set(1, enginePulse, 1);
  pointLight.position.copy(shipGroup.position);

  // Background movement
  gridHelper.position.z = (t * -2000) % 100;
  starField.rotation.y = t * Math.PI * 2;

  // UI Updates
  const displaySpeed = Math.floor(speed * 300000);
  document.getElementById('speed-val').innerText = displaySpeed.toString().padStart(3, '0');
  
  // Smooth UI boost bar color
  const boostFill = document.getElementById('boost-fill');
  boostFill.style.width = boost + '%';
  boostFill.style.background = isBoosting ? '#ffaa00' : '#00dcff';
  boostFill.style.boxShadow = isBoosting ? '0 0 20px #ffaa00' : '0 0 15px #00dcff';
  
  score += Math.floor(speed * 2000);
  document.getElementById('score-val').innerText = score;
}

function animate() {
  requestAnimationFrame(animate);
  update();
  composer.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
