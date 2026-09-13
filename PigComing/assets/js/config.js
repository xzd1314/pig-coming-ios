// ==================== 通用提示（替代alert，适配WebView） ====================
function showToast(msg, duration) {
  duration = duration || 2000;
  let t = document.getElementById('_globalToast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_globalToast';
    t.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#fff;padding:14px 28px;border-radius:10px;font-size:16px;z-index:9999;pointer-events:none;max-width:80vw;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => { t.style.display = 'none'; }, 300); }, duration);
}
// 设置攻击键文字（不同道具按钮文字不同）
function setAttackBtnLabel(text) {
  const b = $('attackBtn');
  if (b) b.textContent = text;
}
// ==================== 配置 ====================
// DOM缓存：游戏循环热路径避免每帧getElementById（元素被移除后自动重查）
const _domCache = {};
function $(id) {
  let el = _domCache[id];
  if (!el || !el.isConnected) { el = document.getElementById(id); _domCache[id] = el; }
  return el;
}
const CELL = 4;
const WALL_H = 3.5;
const PLAYER_H = 1.7;
const PLAYER_RADIUS = 0.4;
const NEXTBOT_SIZE = 2.4;
const PLAYER_SPEED = 4.5;
const SPRINT_SPEED = 8.0;
const SPRINT_DURATION = 1.2;
const SPRINT_COOLDOWN = 3.0;
const BASE_NEXTBOT_SPEED = 3.6;
const GRAVITY = -22;
const JUMP_FORCE = 8.5;
const MAP = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,0,1,1,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
  [1,0,1,0,1,1,1,1,0,1,1,1,1,0,1,0,1],
  [1,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,1],
  [1,1,1,0,1,0,1,1,1,1,1,0,1,0,1,1,1],
  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,1],
  [1,0,1,1,1,1,1,0,1,0,1,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,1],
  [1,0,1,0,1,1,1,1,1,1,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
const MAP_ROWS = MAP.length;
const MAP_COLS = MAP[0].length;
// ==================== 状态 ====================
let scene, camera, renderer;
let player = { x: 0, z: 0, yaw: 0, pitch: 0, jumpY: 0, vy: 0, onGround: true };
let nextbot = { x: 0, z: 0, mesh: null, glowMesh: null, path: [], pathTimer: 0, health: 100, alive: true };
let walls = [];
let gameRunning = false, gamePaused = false;
let gameMode = 'normal'; // normal / hunt / blackpig
let gameTime = 0;
let bestTime = parseFloat(localStorage.getItem('nextbot_best') || '0');
let sprintActive = false, sprintTimer = 0, cooldownTimer = 0;
let clock;
let settings = { noclip: false, noAI: false, dayMode: false, gasMode: false, pigSpeed: 1 };
let ambientLight, dirLight, flashlight;
let joystick = { active: false, id: null, dx: 0, dy: 0, cx: 0, cy: 0 };
let lookTouch = { active: false, id: null, lastX: 0, lastY: 0 };
// 打猪模式状态
let playerHealth = 100;
let swordEquipped = false;
let attackStage = 0; // 0=未使用, 1/2/3=攻击段数
let attackAnimTimer = 0;
let swordMesh = null;
let swordGroup = null;
let pigHitCooldown = 0;
let playerHitCooldown = 0;
// 黑猪模式状态
let blackpig = { mesh: null, frontTex: null, backTex: null, isWatching: false, turnTimer: 0, turnDuration: 0, isTurning: false, podiumMesh: null, x:0, z:-12 };
let deskChairs = []; // 多把椅子，支持多人坐下
let deskChair = { mesh: null, x: 0, z: 0, isSitting: false }; // 兼容旧代码，指向第一把椅子
let standUpCooldown = 0;
// SRT模式
let srt = { mesh:null, x:0, z:0, health:100, alive:true, hasFrog:false, state:'idle', targetX:0, targetZ:0, moveTimer:0, escapeTimer:0 };
let srtFrog = { mesh:null, x:0, z:0, collected:false };
let srtAudio = null;
let srtIsPlayerSRT = false;
let srtSelectedCount = 2;
let srtMapBuilt = false;
const SRT_FIELD_SIZE = 60;
const SRT_ESCAPE_TIME = 60; // SRT拿到青蛙后存活60秒即逃跑成功（玩家失败）
let originalFog = null;
let originalBackground = null;
let blackpigAudioPlaying = null;
let blackpigFieldSize = 60;
// 黑猪模式音频队列
let bpAudioQueue = [];
let bpAudioPlaying = false;
// ==================== 生存模式状态 ====================
let survival = {
  wave: 0,
  pigs: [],           // 当前波次的猪数组
  points: 0,
  totalKills: 0,
  waveActive: false,
  wavePigsRemaining: 0,
  shopOpen: false,
  shopItems: [],
  waveDelay: 0,       // 波次间等待时间
  pigSpeedMultiplier: 1,
  damageMultiplier: 1,
  speedBoost: false,
  speedBoostTimer: 0,
  invincible: false,
  invincibleTimer: 0,
  swordDamageBonus: 0,
  swordDamageTimer: 0,
  maxHp: 100,
};
// ==================== 开发者作弊系统 ====================
let devCheat = {
  enabled: false,      // 密码验证通过
  active: false,       // 作弊模式开关
  nameClickCount: 0,
  nameClickTimer: null,
  password: 'scrhub',
  // 作弊选项
  speed: false,
  speedMult: 2,        // 加速倍数（加速模式勾选时生效）
  noCooldown: false,
  damage: 50,
  wallhack: false,
  autoAim: false,
  invincible: false,   // 无敌模式
  esp: false,          // 透视模式：高亮所有NPC和玩家
};
// ==================== ESP透视系统 ==================
let _espWireframes = [];  // [{mesh, type, ref}] — 所有ESP线框实例
function createESPBox(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  const line = new THREE.LineSegments(edges, mat);
  line.renderOrder = 9999;
  line.frustumCulled = false;
  geo.dispose();
  return line;
}
function ensureESPIfNeeded() {
  if (!scene || !gameRunning) return;
  // 猪（normal/hunt模式）：nextbot + extraBots
  if ((gameMode === 'normal' || gameMode === 'hunt') && nextbot && nextbot.mesh) {
    if (!_espWireframes.find(e => e.type === 'nextbot' && e.ref === nextbot)) {
      const box = createESPBox(3, 3.2, 3, 0xff2222);
      scene.add(box);
      _espWireframes.push({ mesh: box, type: 'nextbot', ref: nextbot });
    }
  }
  for (const bot of (MP.extraBots || [])) {
    if (!_espWireframes.find(e => e.type === 'extraBot' && e.ref === bot)) {
      const col = MP.PLAYER_COLORS[bot.colorIdx % MP.PLAYER_COLORS.length];
      const box = createESPBox(3, 3.2, 3, col);
      scene.add(box);
      _espWireframes.push({ mesh: box, type: 'extraBot', ref: bot });
    }
  }
  // 黑猪模式
  if (gameMode === 'blackpig' && blackpig && blackpig.mesh) {
    if (!_espWireframes.find(e => e.type === 'blackpig' && e.ref === blackpig)) {
      const box = createESPBox(4.5, 4.5, 4.5, 0xff44ff);
      scene.add(box);
      _espWireframes.push({ mesh: box, type: 'blackpig', ref: blackpig });
    }
  }
  // SRT模式
  if (gameMode === 'srt' && srt && srt.mesh) {
    if (!_espWireframes.find(e => e.type === 'srt' && e.ref === srt)) {
      const box = createESPBox(4.5, 4.5, 4.5, 0xffdd44);
      scene.add(box);
      _espWireframes.push({ mesh: box, type: 'srt', ref: srt });
    }
  }
  // 生存模式猪
  if (gameMode === 'survival') {
    for (const pig of (survival.pigs || [])) {
      if (pig.alive && !_espWireframes.find(e => e.type === 'survivalPig' && e.ref === pig)) {
        const box = createESPBox(3, 3.2, 3, 0xff4444);
        scene.add(box);
        _espWireframes.push({ mesh: box, type: 'survivalPig', ref: pig });
      }
    }
  }
  // 打猪枪战猪（复用 survivalPig 渲染逻辑：ref.x/ref.z/ref.alive）
  if (gameMode === 'pigshoot' && typeof gun !== 'undefined' && gun.pigs) {
    for (const pig of gun.pigs) {
      if (pig.alive && !_espWireframes.find(e => e.type === 'survivalPig' && e.ref === pig)) {
        const box = createESPBox(3, 3.2, 3, 0xff4444);
        scene.add(box);
        _espWireframes.push({ mesh: box, type: 'survivalPig', ref: pig });
      }
    }
  }
  // 联机其他玩家
  if (MP.mode === 'host') {
    for (const id in MP.players) {
      const p = MP.players[id];
      if (p && p.mesh && !_espWireframes.find(e => e.type === 'remotePlayer' && e.ref === p)) {
        const col = MP.PLAYER_COLORS[p.color % MP.PLAYER_COLORS.length];
        const box = createESPBox(1.5, 2.5, 1.5, col);
        scene.add(box);
        _espWireframes.push({ mesh: box, type: 'remotePlayer', ref: p });
      }
    }
  }
  if (MP.mode === 'client') {
    for (const id in MP.remotePlayers) {
      const rp = MP.remotePlayers[id];
      if (rp && rp.mesh && !_espWireframes.find(e => e.type === 'remotePlayer' && e.ref === rp)) {
        const col = MP.PLAYER_COLORS[rp.color % MP.PLAYER_COLORS.length];
        const box = createESPBox(1.5, 2.5, 1.5, col);
        scene.add(box);
        _espWireframes.push({ mesh: box, type: 'remotePlayer', ref: rp });
      }
    }
  }
}
function updateESP() {
  const show = devCheat.active && devCheat.esp;
  if (show) ensureESPIfNeeded();
  for (let i = _espWireframes.length - 1; i >= 0; i--) {
    const e = _espWireframes[i];
    const ref = e.ref;
    if (!show || !ref || !e.mesh) {
      if (e.mesh && e.mesh.visible) e.mesh.visible = false;
      if (!show && e.mesh) { scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose(); _espWireframes.splice(i, 1); }
      continue;
    }
    // 获取目标位置和可见状态
    let x, y, z, visible = true;
    if (e.type === 'nextbot' || e.type === 'extraBot' || e.type === 'survivalPig') {
      x = ref.x; y = 1.6; z = ref.z;
      visible = ref.alive !== false;
    } else if (e.type === 'blackpig') {
      x = ref.x || 0; y = 3; z = ref.z || -12;
    } else if (e.type === 'srt') {
      x = ref.x; y = 2; z = ref.z;
      visible = ref.alive !== false;
    } else if (e.type === 'remotePlayer') {
      x = ref.x; y = 1.2; z = ref.z;
      visible = !ref.dead;
    } else { continue; }
    e.mesh.visible = visible;
    if (visible) e.mesh.position.set(x, y, z);
  }
}
function clearESP() {
  for (const e of _espWireframes) {
    if (e.mesh && scene) scene.remove(e.mesh);
    if (e.mesh) { try { e.mesh.geometry.dispose(); e.mesh.material.dispose(); } catch(err) {} }
  }
  _espWireframes = [];
}
// ==================== 作弊生效计算 ====================
// 攻击伤害：开发者模式生效时用自定义伤害覆盖三段基础伤害(15/20/30)；bonus为附加加成（如打福瑞模式强化）
function getAttackDamage(stage, bonus) {
  const base = stage === 1 ? 15 : stage === 2 ? 20 : 30;
  const b = bonus || 0;
  if (devCheat.active && devCheat.damage > 0) return devCheat.damage + b;
  return base + b;
}
// 移动速度倍率：加速模式勾选时返回输入框的倍数，否则1（适用于所有模式的移动计算）
function devSpeedMult() {
  return (devCheat.active && devCheat.speed) ? (devCheat.speedMult || 2) : 1;
}
// 无敌模式是否生效（单机/主机端免疫伤害与即死判定）
function devInvincible() {
  return !!(devCheat.active && devCheat.invincible);
}
// 自动锁敌是否生效（攻击判定忽略朝向角度，范围内全部命中）
function devAutoAim() {
  return !!(devCheat.active && devCheat.autoAim);
}
// ==================== 玩家统计（我的信息） ====================
const MODE_NAMES = {
  normal: '普通模式', hunt: '打猪模式', blackpig: '黑猪模式', srt: 'SRT模式',
  pvp: 'PVP对战', survival: '打福瑞模式', hide: '捉迷藏模式',
  pigshoot: '打猪枪战', pvpgun: 'PVP枪战',
};
let playerStats = loadPlayerStats();
function loadPlayerStats() {
  try { const s = JSON.parse(localStorage.getItem('zhulaile_stats') || '{}'); return (s && typeof s === 'object') ? s : {}; } catch (e) { return {}; }
}
function savePlayerStats() { try { localStorage.setItem('zhulaile_stats', JSON.stringify(playerStats)); } catch (e) {} }
function getModeStat(mode) {
  if (!MODE_NAMES[mode]) return null;
  if (!playerStats[mode]) playerStats[mode] = {};
  const s = playerStats[mode];
  s.plays = s.plays || 0; s.kills = s.kills || 0; s.wins = s.wins || 0;
  s.bestScore = s.bestScore || 0; s.bestWave = s.bestWave || 0; s.bestTime = s.bestTime || 0;
  return s;
}
function recordGameStart(mode) { const s = getModeStat(mode); if (s) { s.plays++; savePlayerStats(); } }
function recordKill(mode, n) { const s = getModeStat(mode); if (s) { s.kills += (n || 1); savePlayerStats(); } }
function recordWin(mode) { const s = getModeStat(mode); if (s) { s.wins++; savePlayerStats(); } }
function recordBest(mode, field, val) { const s = getModeStat(mode); if (s && val > (s[field] || 0)) { s[field] = val; savePlayerStats(); } }
