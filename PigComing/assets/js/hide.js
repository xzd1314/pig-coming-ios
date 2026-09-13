// ============================================================
// 猪来了NextBot - 捉迷藏模式（多人专属）
// 房主选抓捕者 → 10秒躲藏期（抓捕者黑屏）→ 60秒搜捕（一刀致命）
// 全部找到=抓捕者胜；超时有人存活=躲藏者胜
// ============================================================

const HIDE_FIELD = 70;
const HIDE_COUNTDOWN = 10;
const HIDE_ROUND_TIME = 60;
const HIDE_KILL_RANGE = 3.4;

let hideMapBuilt = false;
let hideColliders = [];   // {minX,maxX,minZ,maxZ}
let hide = { seeker: 'host', phase: 'idle', timer: 0 }; // phase: idle/hide/seek/over
let hideBlackoutOn = false;

// ==================== 地图 ====================
function hideAddBox(name, x, z, w, d, h, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, h / 2, z);
  m.name = name;
  scene.add(m);
  hideColliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  return m;
}

function buildHideMap() {
  hideMaze();
  originalFog = scene.fog;
  originalBackground = scene.background;
  // 夜晚庭院：暗绿雾
  scene.fog = new THREE.Fog(0x16241c, 8, 42);
  scene.background = new THREE.Color(0x0c1712);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HIDE_FIELD, HIDE_FIELD),
    new THREE.MeshStandardMaterial({ color: 0x2e4d2e, roughness: 1 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'hide_floor';
  scene.add(floor);
  // 边界围墙
  const half = HIDE_FIELD / 2;
  hideAddBox('hide_wall', 0, -half, HIDE_FIELD, 2, 4, 0x3a4a3a);
  hideAddBox('hide_wall', 0, half, HIDE_FIELD, 2, 4, 0x3a4a3a);
  hideAddBox('hide_wall', -half, 0, 2, HIDE_FIELD, 4, 0x3a4a3a);
  hideAddBox('hide_wall', half, 0, 2, HIDE_FIELD, 4, 0x3a4a3a);
  // 中央地标（抓捕者出生点旁）
  hideAddBox('hide_center', 0, -18, 8, 3, 2.2, 0x556677);
  // 三座小屋（实心建筑，绕行躲藏）
  hideAddBox('hide_house1', -20, -10, 10, 8, 5, 0x6b4f3a);
  hideAddBox('hide_house2', 18, -8, 12, 8, 5, 0x6b4f3a);
  hideAddBox('hide_house3', 0, 20, 14, 9, 5.5, 0x5d4433);
  // 矮墙迷宫动线
  const mazeWalls = [
    { x: -10, z: 5, w: 14, d: 1.5 }, { x: 12, z: 8, w: 1.5, d: 16 },
    { x: -22, z: 14, w: 1.5, d: 14 }, { x: 22, z: -18, w: 12, d: 1.5 },
    { x: -6, z: -6, w: 1.5, d: 12 }, { x: 8, z: -14, w: 10, d: 1.5 },
    { x: -14, z: -16, w: 8, d: 1.5 }, { x: 2, z: 10, w: 10, d: 1.5 },
    { x: -14, z: 24, w: 10, d: 1.5 }, { x: 24, z: 2, w: 1.5, d: 10 },
  ];
  for (const m of mazeWalls) hideAddBox('hide_maze', m.x, m.z, m.w, m.d, 3, 0x4a5a48);
  // 散落木箱（绕柱躲藏点）
  const crates = [
    [-25, 2], [-18, -22], [25, 18], [10, 24], [-8, 18], [26, -2], [-26, 24],
    [15, -24], [-3, -26], [6, 0], [18, 12], [-24, -6],
  ];
  for (const [cx, cz] of crates) hideAddBox('hide_crate', cx, cz, 2.2, 2.2, 2.2, 0x8a6a3a);
  // 灌木丛（可钻的billboard）
  const bushCanvas = document.createElement('canvas');
  bushCanvas.width = 64; bushCanvas.height = 64;
  const bctx = bushCanvas.getContext('2d');
  const grd = bctx.createRadialGradient(32, 36, 4, 32, 36, 30);
  grd.addColorStop(0, 'rgba(80,150,66,1)');
  grd.addColorStop(1, 'rgba(40,90,40,0.92)');
  bctx.fillStyle = grd;
  bctx.beginPath(); bctx.arc(32, 36, 28, 0, Math.PI * 2); bctx.fill();
  const bushTex = new THREE.CanvasTexture(bushCanvas);
  const bushMat = new THREE.SpriteMaterial({ map: bushTex, transparent: true });
  const bushPos = [
    [-12, 12], [14, 2], [-20, 8], [8, 16], [22, 10], [-16, -12], [12, -10],
    [-10, -22], [20, 22], [-28, 16], [4, -18], [26, 4], [-6, 2], [-24, -18], [16, 26],
  ];
  for (const [bx, bz] of bushPos) {
    const s = new THREE.Sprite(bushMat);
    s.scale.set(3.2, 3.2, 1);
    s.position.set(bx, 1.5, bz);
    s.name = 'hide_bush';
    scene.add(s);
  }
  // 环境灯（暖+冷两盏路灯）
  const lamp1 = new THREE.PointLight(0xffcc88, 0.9, 30);
  lamp1.position.set(-15, 5, -5); lamp1.name = 'hide_lamp'; scene.add(lamp1);
  const lamp2 = new THREE.PointLight(0x88aaff, 0.7, 30);
  lamp2.position.set(15, 5, 12); lamp2.name = 'hide_lamp'; scene.add(lamp2);
  if (ambientLight) ambientLight.intensity = 0.5;
  if (dirLight) dirLight.intensity = 0.35;
  hideMapBuilt = true;
}

function clearHideMap() {
  const names = ['hide_floor', 'hide_wall', 'hide_center', 'hide_house1', 'hide_house2', 'hide_house3', 'hide_maze', 'hide_crate', 'hide_bush', 'hide_lamp'];
  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (names.includes(scene.children[i].name)) {
      const m = scene.children[i];
      scene.remove(m);
      if (typeof disposeMesh === 'function') disposeMesh(m);
      else { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }
    }
  }
  hideColliders = [];
  if (originalFog) { scene.fog = originalFog; originalFog = null; }
  scene.background = originalBackground;
  originalBackground = null;
  if (ambientLight) ambientLight.intensity = 0.55;
  if (dirLight) dirLight.intensity = 0.4;
  showMaze();
  hideMapBuilt = false;
}

// ==================== 碰撞 ====================
function hideCollides(x, z, radius) {
  for (const c of hideColliders) {
    const cx = Math.max(c.minX, Math.min(x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}
function moveWithHideCollision(obj, dx, dz, radius) {
  const nx = obj.x + dx; if (!hideCollides(nx, obj.z, radius)) obj.x = nx;
  const nz = obj.z + dz; if (!hideCollides(obj.x, nz, radius)) obj.z = nz;
}

// ==================== 角色与胜负 ====================
function hideIAmSeeker() {
  const myId = (MP.mode === 'host') ? 'host' : MP.myId;
  return hide.seeker === myId;
}
function totalHiders() {
  let n = 0;
  if (hide.seeker !== 'host') n++;
  for (const id in MP.players) if (id !== hide.seeker) n++;
  return n;
}
function countAliveHiders() {
  let n = 0;
  if (hide.seeker !== 'host' && !MP._hostDead) n++;
  for (const id in MP.players) {
    if (id === hide.seeker) continue;
    if (!MP.players[id].dead) n++;
  }
  return n;
}

// 主机：阶段推进与胜负判定
function hideUpdate(dt) {
  if (MP.mode !== 'host' || !gameRunning) return;
  if (hide.phase === 'hide') {
    hide.timer -= dt;
    if (hide.timer <= 0) {
      hide.phase = 'seek';
      hide.timer = HIDE_ROUND_TIME;
      if (typeof hostBroadcastState === 'function') hostBroadcastState();
      if (typeof showToast === 'function' && hideIAmSeeker()) showToast('开始搜索！', 1500);
    }
  } else if (hide.phase === 'seek') {
    hide.timer -= dt;
    if (countAliveHiders() === 0) endHideGame('seeker');
    else if (hide.timer <= 0) endHideGame('hider');
  }
}

function endHideGame(winner) {
  hide.phase = 'over';
  if (MP.mode === 'host') {
    Bridge.broadcast(JSON.stringify({ type: 'hideEvent', event: winner === 'seeker' ? 'seekerWin' : 'hiderWin' }));
  }
  showHideGameOver(winner);
}

function showHideGameOver(winner) {
  gameRunning = false; gamePaused = false;
  const iAmSeeker = hideIAmSeeker();
  const myWin = iAmSeeker ? (winner === 'seeker') : (winner === 'hider');
  if (myWin && typeof recordWin === 'function') recordWin('hide');
  if (typeof stopSurvivalAudio === 'function') stopSurvivalAudio();
  const info = document.getElementById('hideInfo');
  if (info) info.style.display = 'none';
  const bo = document.getElementById('hideBlackout');
  if (bo) bo.style.display = 'none';
  hideBlackoutOn = false;
  document.getElementById('attackBtn').style.display = 'none';
  document.getElementById('hotbar').style.display = 'none';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('distance').style.display = 'none';
  const go = document.getElementById('gameOverScreen');
  go.querySelector('h1').textContent = winner === 'seeker' ? '抓捕者胜利！' : '躲藏者胜利！';
  go.querySelector('.time-text').textContent = iAmSeeker
    ? (winner === 'seeker' ? '你找出了所有躲藏者！' : '时间到，仍有躲藏者存活')
    : (winner === 'hider' ? '你活到了最后！' : '你被抓住了');
  go.querySelector('.best-text').textContent = '';
  go.style.display = 'flex';
}

// ==================== 抓捕 ====================
// 房主自己是抓捕者时的近战判定
function checkHideHit() {
  if (MP.mode !== 'host' || !hideIAmSeeker()) return;
  if (hide.phase !== 'seek') {
    if (typeof showToast === 'function') showToast('抓捕还没开始！', 1200);
    return;
  }
  const fwd = { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) };
  for (const id in MP.players) {
    if (id === hide.seeker) continue;
    const p = MP.players[id];
    if (p.dead) continue;
    const dx = p.x - player.x, dz = p.z - player.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > HIDE_KILL_RANGE) continue;
    const toP = { x: dx / dist, z: dz / dist };
    if (!devAutoAim() && fwd.x * toP.x + fwd.z * toP.z < 0.3) continue;
    // 一刀致命
    if (typeof spawnKillBurst === 'function') spawnKillBurst(p.x, 1.4, p.z);
    if (p.mesh && typeof animateDeath === 'function') animateDeath(p.mesh);
    hostDamagePlayer(id, true);
    if (typeof recordKill === 'function') recordKill('hide');
  }
}

// ==================== HUD ====================
function updateHideBlackout() {
  const el = document.getElementById('hideBlackout');
  if (!el) return;
  const iAmSeeker = hideIAmSeeker();
  const shouldShow = iAmSeeker && gameRunning && gameMode === 'hide' && hide.phase === 'hide';
  if (shouldShow) {
    if (!hideBlackoutOn) { hideBlackoutOn = true; el.style.display = 'flex'; }
    const t = Math.ceil(hide.timer);
    const txt = '抓捕者蒙眼中...\n' + t + ' 秒后开始搜索';
    if (el.dataset.txt !== String(t)) {
      el.dataset.txt = String(t);
      el.innerHTML = '<div style="text-align:center;"><div style="font-size:20px;color:#888;">抓捕者蒙眼中</div><div style="font-size:56px;font-weight:bold;color:#ff5544;margin-top:8px;">' + t + '</div><div style="font-size:14px;color:#666;margin-top:8px;">躲藏者快跑！</div></div>';
    }
  } else if (hideBlackoutOn) {
    hideBlackoutOn = false;
    el.style.display = 'none';
    if (iAmSeeker && typeof showToast === 'function') showToast('开始搜索！' + HIDE_ROUND_TIME + '秒内找出所有躲藏者！', 2200);
  }
}

function updateHideHud() {
  const el = document.getElementById('hideInfo');
  if (!el) return;
  if (gameMode !== 'hide' || !gameRunning) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const iAmSeeker = hideIAmSeeker();
  const role = iAmSeeker ? '【抓捕者】' : '【躲藏者】';
  if (hide.phase === 'hide') {
    const t = Math.ceil(hide.timer);
    el.textContent = role + (iAmSeeker ? '蒙眼中... ' : '快躲起来！') + t + 's';
    el.style.color = iAmSeeker ? '#ffaa00' : '#44ff88';
  } else if (hide.phase === 'seek') {
    el.textContent = role + '剩余 ' + Math.ceil(hide.timer) + 's | 未找到: ' + countAliveHiders() + '人';
    el.style.color = '#ffdd66';
  }
}
