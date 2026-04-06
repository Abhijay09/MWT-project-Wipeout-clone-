import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const API_URL = 'https://mwt-wipeout.onrender.com';

/** 
 * GAME STATE
 */
let gameRunning = false;
let score = 0, boost = 100, t = 0, lives = 3;
let speed = 0, lateralOffset = 0, targetLateralOffset = 0, shipRotationZ = 0;
let lastHitTime = 0;

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
const gridHelper = new THREE.GridHelper(4000, 150, 0xff00aa, 0x220044);
gridHelper.position.y = -150;
scene.add(gridHelper);

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
for (let i = 0; i < 200; i++) {
  const angle = (i / 200) * Math.PI * 2;
  const x = Math.sin(angle) * 450 + Math.sin(angle * 3) * 80;
  const y = Math.cos(angle * 2) * 80 + Math.sin(angle * 5) * 30;
  const z = Math.cos(angle) * 450 + Math.cos(angle * 3) * 80;
  curvePoints.push(new THREE.Vector3(x, y, z));
}
const spline = new THREE.CatmullRomCurve3(curvePoints, true);

const trackGeo = new THREE.TubeGeometry(spline, 1200, 18, 20, true);
const canvas = document.createElement('canvas');
canvas.width = 512; canvas.height = 512;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#080808'; 
ctx.fillRect(0,0,512,512);
ctx.strokeStyle = '#222';
ctx.lineWidth = 2;
ctx.strokeRect(0,0,512,512);

ctx.shadowBlur = 15; ctx.shadowColor = '#00dcff'; ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 8;
ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(512, 10); ctx.stroke();
ctx.shadowColor = '#ff00aa'; ctx.strokeStyle = '#ff00aa'; 
ctx.beginPath(); ctx.moveTo(0, 502); ctx.lineTo(512, 502); ctx.stroke();

const trackTex = new THREE.CanvasTexture(canvas);
trackTex.wrapS = THREE.RepeatWrapping; trackTex.wrapT = THREE.RepeatWrapping;
trackTex.repeat.set(400, 2); 

const trackMat = new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
const trackMesh = new THREE.Mesh(trackGeo, trackMat);
scene.add(trackMesh);

/**
 * OBSTACLE SYSTEM (Mines)
 */
const obstacles = [];

function makeObstacleMesh(color) {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color: color });
  const core = new THREE.Mesh(new THREE.SphereGeometry(2.93, 16, 16), coreMat);
  group.add(core);

  const glowMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.25, side: THREE.BackSide });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(5.05, 16, 16), glowMat);
  group.add(glow);

  const ringCol = color === 0xffdd00 ? 0xffaa00 : 0xff6600;
  const ringMat = new THREE.MeshBasicMaterial({ color: ringCol, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.52, 0.29, 8, 32), ringMat);
  ring.userData.isRing = true;
  group.add(ring);

  return group;
}

for (let i = 0.05; i < 1; i += 0.03) {
  const lane = Math.random() < 0.5 ? -8 : 8; 
  const color = lane === -8 ? 0xff1111 : 0xffdd00; 
  const pos = spline.getPointAt(i);
  const tangent = spline.getTangentAt(i);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
  
  const mine = makeObstacleMesh(color);
  mine.position.copy(pos).addScaledVector(side, lane).addScaledVector(up, 2);
  mine.lookAt(pos.clone().add(tangent));
  
  scene.add(mine);
  obstacles.push({ mesh: mine, t: i, lane: lane, color: color });
}

/**
 * THE SHIP 
 */
const shipGroup = new THREE.Group();
const hullMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
const hullGeo = new THREE.ConeGeometry(0.8, 4, 16);
hullGeo.rotateX(Math.PI / 2);
const hull = new THREE.Mesh(hullGeo, hullMat);
shipGroup.add(hull);

const glassMat = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 1, roughness: 0, emissive: 0x110033 });
const glassGeo = new THREE.SphereGeometry(0.6, 16, 16);
const glass = new THREE.Mesh(glassGeo, glassMat);
glass.scale.set(0.8, 0.6, 2);
glass.position.set(0, 0.3, -0.2);
shipGroup.add(glass);

const wingGeo = new THREE.ConeGeometry(2.5, 3, 3);
wingGeo.rotateX(Math.PI / 2);
const wings = new THREE.Mesh(wingGeo, hullMat);
wings.scale.set(2, 0.1, 0.8);
wings.position.set(0, -0.2, 0.8);
shipGroup.add(wings);

const accentGeo = new THREE.BoxGeometry(9.5, 0.12, 0.2);
const accentMat = new THREE.MeshBasicMaterial({ color: 0x00dcff });
const accent = new THREE.Mesh(accentGeo, accentMat);
accent.position.set(0, -0.2, 1.8);
shipGroup.add(accent);

const engineMat = new THREE.MeshBasicMaterial({ color: 0xff00aa });
const engGeo = new THREE.CylinderGeometry(0.25, 0.4, 0.8, 16);
engGeo.rotateX(Math.PI / 2);
const eng1 = new THREE.Mesh(engGeo, engineMat);
eng1.position.set(-0.6, 0, 1.8);
const eng2 = eng1.clone();
eng2.position.set(0.6, 0, 1.8);
shipGroup.add(eng1, eng2);

scene.add(shipGroup);

// Speed Lines
const linesGroup = new THREE.Group();
const lineMat = new THREE.MeshBasicMaterial({ color: 0x00dcff, transparent: true, opacity: 0.4 });
for(let i=0; i<150; i++) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, Math.random() * 20 + 10), lineMat);
  mesh.position.set((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 50, -Math.random() * 150 - 20);
  linesGroup.add(mesh);
}
linesGroup.visible = false;
camera.add(linesGroup);

/**
 * BACKEND LOGIC (Fetch and Save)
 */
async function loadLeaderboard() {
  const listEl = document.getElementById('leaderboard-list');
  listEl.innerHTML = '<div style="color:#00dcff;">LOADING...</div>';

  try {
    const response = await fetch(`${API_URL}/leaderboard`);
    const data = await response.json();

    listEl.innerHTML = '';
    if (data.length === 0) {
      listEl.innerHTML = '<div style="color:#ccc;">NO RECORDS FOUND</div>';
    } else {
      data.forEach((row, index) => {
        listEl.innerHTML += `
          <div class="score-row">
            <span>${index + 1}. ${row.name.toUpperCase()}</span>
            <span>${Math.floor(row.score).toLocaleString()}</span>
          </div>`;
      });
    }
  } catch (err) {
    listEl.innerHTML = '<div style="color:#ff1111;">SERVER OFFLINE</div>';
  }
}

window.submitScore = async function() {
  const nameInput = document.getElementById('player-name').value.trim() || 'VOID';
  const finalScore = Math.floor(score);

  const btn = document.querySelector('#menu-gameover .btn');
  btn.innerText = 'SAVING...';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameInput, score: finalScore })
    });
    
    if (res.ok) {
        window.showScreen('menu-leaderboard');
    } else {
        alert("Server error while saving.");
    }
  } catch (err) {
    alert("Could not connect to server.");
  } finally {
    btn.innerText = 'SAVE & EXIT';
    btn.disabled = false;
  }
};

/**
 * MENU ACTIONS
 */
window.showScreen = function(screenId) {
  document.querySelectorAll('.menu-screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');

  if (screenId === 'menu-leaderboard') {
    loadLeaderboard();
  }
}

window.startGame = function() {
  const overlay = document.getElementById('overlay');
  if(overlay) overlay.classList.add('hidden');
  
  lives = 3;
  score = 0;
  boost = 100;
  t = 0;
  speed = 0;
  lateralOffset = 0;
  targetLateralOffset = 0;
  lastHitTime = 0;
  
  updateLivesUI();
  gameRunning = true;
}

function updateLivesUI() {
  const bars = document.querySelectorAll('.life-bar');
  bars.forEach((bar, index) => {
    if (index < lives) {
      bar.classList.remove('lost');
    } else {
      bar.classList.add('lost');
    }
  });
}

function gameOver() {
  gameRunning = false;
  const overlay = document.getElementById('overlay');
  if(overlay) overlay.classList.remove('hidden');
  window.showScreen('menu-gameover');
  
  const finalScoreEl = document.getElementById('final-score-val');
  if(finalScoreEl) finalScoreEl.innerText = Math.floor(score).toLocaleString();
}

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

  // Accel/Brake Logic
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
    engineMat.color.setHex(0xffaa00); 
    lineMat.color.setHex(0xffaa00);
    pointLight.color.setHex(0xffaa00);
    pointLight.intensity = 6; 
  } else {
    boost = Math.min(100, boost + 0.1);
    camera.fov += (75 - camera.fov) * 0.1;
    engineMat.color.setHex(0xff00aa);
    lineMat.color.setHex(0x00dcff);
    pointLight.color.setHex(0x00dcff);
    pointLight.intensity = 3;
  }
  camera.updateProjectionMatrix();

  speed = Math.max(0, Math.min(speed, currentMax));
  t = (t + speed) % 1;

  // Steering
  if (keys['KeyA'] || keys['ArrowLeft']) targetLateralOffset = -8;
  else if (keys['KeyD'] || keys['ArrowRight']) targetLateralOffset = 8;
  else targetLateralOffset = 0;

  lateralOffset += (targetLateralOffset - lateralOffset) * 0.08;
  shipRotationZ += (-lateralOffset * 0.15 - shipRotationZ) * 0.15;

  // Collision Detection
  obstacles.forEach(obs => {
    const tDiff = Math.min(Math.abs(t - obs.t), 1 - Math.abs(t - obs.t));
    if (tDiff < 0.0015 && Math.abs(lateralOffset - obs.lane) < 8.5 && now - lastHitTime > 1000) {
      speed *= 0.2;
      score = Math.max(0, score - 500);
      lastHitTime = now;
      triggerHitFlash();
      
      lives--;
      updateLivesUI();
      if (lives <= 0) {
        gameOver();
        return; 
      }
      
      obs.mesh.children.forEach(c => { if(c.material) c.material.color.setHex(0xffffff); });
      setTimeout(() => {
        obs.mesh.children[0].material.color.setHex(obs.color);
        obs.mesh.children[1].material.color.setHex(obs.color);
      }, 100);
    }
  });

  // Ship Placement and Orientation
  const pos = spline.getPointAt(t);
  const tangent = spline.getTangentAt(t);
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(tangent, up).normalize(); 
  const refinedUp = new THREE.Vector3().crossVectors(side, tangent).normalize();

  shipGroup.position.copy(pos);
  shipGroup.position.add(side.clone().multiplyScalar(lateralOffset));
  shipGroup.position.add(refinedUp.clone().multiplyScalar(2.5)); 
  
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
  shipGroup.rotateZ(shipRotationZ);

  // Ship Flicker on Hit
  shipGroup.visible = (now - lastHitTime < 1000) ? (now % 100 > 50) : true;

  // Camera Follow Rig
  const camOffset = new THREE.Vector3(0, 5, 16); 
  camOffset.applyQuaternion(baseQuat);
  const targetCamPos = shipGroup.position.clone().add(camOffset);
  camera.position.lerp(targetCamPos, 0.3);
  
  const camLookOffset = new THREE.Vector3(0, 1, -20);
  camLookOffset.applyQuaternion(baseQuat);
  const targetCamLook = shipGroup.position.clone().add(camLookOffset);
  camera.lookAt(targetCamLook);

  // Speed Lines logic
  const displaySpeed = Math.floor(speed * 300000);
  linesGroup.visible = displaySpeed >= 100;

  if (linesGroup.visible) {
    linesGroup.children.forEach(line => {
      line.position.z += (speed * 12000) * (isBoosting ? 1.5 : 1);
      if (line.position.z > 5) {
        line.position.z = -100 - Math.random() * 80;
        line.position.x = (Math.random() - 0.5) * 80;
        line.position.y = (Math.random() - 0.5) * 50;
      }
    });
  }

  // Mine Animations
  obstacles.forEach(obs => {
    obs.mesh.children.forEach(c => {
      if (c.userData.isRing) c.rotation.y += 0.05;
    });
    const pulse = 1 + Math.sin(now * 0.005 + obs.t * 100) * 0.1;
    obs.mesh.children[0].scale.setScalar(pulse);
  });

  const enginePulse = 1 + Math.random() * 0.3 + (speed / MAX_SPEED);
  eng1.scale.set(1, enginePulse, 1);
  eng2.scale.set(1, enginePulse, 1);
  pointLight.position.copy(shipGroup.position);

  // Background
  gridHelper.position.z = (t * -2000) % 100;
  starField.rotation.y = t * 2;

  // UI Updates
  const speedEl = document.getElementById('speed-val');
  if(speedEl) speedEl.innerText = displaySpeed.toString().padStart(3, '0');
  
  const boostFill = document.getElementById('boost-fill');
  if(boostFill) {
    boostFill.style.width = boost + '%';
    boostFill.style.background = isBoosting ? '#ffaa00' : '#00dcff';
  }
  
  score += Math.floor(speed * 2000);
  const scoreEl = document.getElementById('score-val');
  if(scoreEl) scoreEl.innerText = Math.floor(score).toLocaleString();
}

/**
 * INPUTS
 */
const keys = {};
window.onkeydown = (e) => keys[e.code] = true;
window.onkeyup = (e) => keys[e.code] = false;

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
