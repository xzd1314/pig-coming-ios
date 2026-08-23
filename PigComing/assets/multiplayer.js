// ==================== 联机模块 V2 ====================
const MP = {
  mode: 'offline',
  myId: null,
  myName: localStorage.getItem('pig_player_name') || '玩家',
  myColor: 0,
  roomPort: 8765,
  serverRunning: false,
  connected: false,
  players: {},
  remotePlayers: {},
  lastInputSend: 0,
  lastStateBroadcast: 0,
  scanTimer: null,
  foundRooms: [],
  onRoomListUpdate: null,
  gameStarted: false,
  selectedMode: 'normal',
  playerList: [],
  PLAYER_COLORS: [0xff4444, 0x4488ff, 0x44ff44, 0xffdd44, 0xcc44ff, 0xff8844],
  PLAYER_COLOR_NAMES: ['红','蓝','绿','黄','紫','橙'],
  MAX_PLAYERS: 6,
  MAX_HEALTH: 100,
  RESPAWN_TIME: 5,
  INVINCIBLE_TIME: 3,
  extraBots: [],
  _hostHealth: 100, _hostDead: false, _hostRespawnTimer: 0, _hostInvincible: 0,
  _clientDead: false,
};

const Bridge = {
  available() {
    return !!(window.AndroidBridge || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge));
  },
  call(method, args) {
    const payload = JSON.stringify({ method, args: args || {} });
    if (window.AndroidBridge && typeof window.AndroidBridge.call === 'function') {
      return window.AndroidBridge.call(payload);
    }
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge) {
      window.webkit.messageHandlers.bridge.postMessage(payload);
      return null;
    }
    return null;
  },
  startServer(port) { return this.call('startServer', { port }); },
  stopServer() { return this.call('stopServer', {}); },
  broadcast(msg) { return this.call('broadcast', { msg }); },
  sendTo(id, msg) { return this.call('sendTo', { id, msg }); },
  connect(ip, port) { return this.call('connect', { ip, port }); },
  disconnect() { return this.call('disconnect', {}); },
  send(msg) { return this.call('send', { msg }); },
  startBroadcast(roomInfo) { return this.call('startBroadcast', { roomInfo }); },
  stopBroadcast() { return this.call('stopBroadcast', {}); },
  startScan() { return this.call('startScan', {}); },
  stopScan() { return this.call('stopScan', {}); },
  getLocalIP() { return this.call('getLocalIP', {}); },
};

window.NativeCallback = {
  onServerStarted(ip, port) {
    MP.serverRunning = true; MP.myId = 'host'; MP.myColor = 0; MP.mode = 'host';
    if (MP.onServerReady) MP.onServerReady(ip, port);
  },
  onServerStopped() { MP.serverRunning = false; MP.mode = 'offline'; cleanupMultiplayer(); },
  onClientConnected(clientId) { console.log('[MP] client connected:', clientId); },
  onClientDisconnected(clientId) {
    if (MP.players[clientId]) { removePlayerMesh(MP.players[clientId]); delete MP.players[clientId]; broadcastPlayerList(); }
  },
  onMessage(clientId, msgStr) {
    try { handleHostMessage(clientId, JSON.parse(msgStr)); } catch(e) { console.error('[MP] parse:', e); }
  },
  onConnected() { MP.connected = true; if (MP.onConnected) MP.onConnected(); },
  onDisconnected() {
    MP.connected = false; MP.mode = 'offline'; cleanupMultiplayer();
    if (MP.onDisconnected) MP.onDisconnected();
  },
  onServerMessage(msgStr) {
    try { handleClientMessage(JSON.parse(msgStr)); } catch(e) { console.error('[MP] msg:', e); }
  },
  onRoomFound(roomInfoStr) {
    try {
      const info = JSON.parse(roomInfoStr);
      const idx = MP.foundRooms.findIndex(r => r.ip === info.ip && r.port === info.port);
      info._lastSeen = Date.now();
      if (idx >= 0) MP.foundRooms[idx] = info; else MP.foundRooms.push(info);
      if (MP.onRoomListUpdate) MP.onRoomListUpdate(MP.foundRooms);
    } catch(e) {}
  },
  onScanFinished() {},
  onLocalIP(ip) { MP._cachedIP = ip; },
};

function createPlayerLabel(name, color, health) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
  const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat); sprite.scale.set(1.8, 0.56, 1);
  sprite.userData = { canvas, tex, name, color, health };
  drawPlayerLabel(sprite);
  return sprite;
}
function drawPlayerLabel(sprite) {
  const { canvas, name, color, health } = sprite.userData;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 256, 80);
  const colorHex = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  const nameW = Math.min(ctx.measureText(name).width + 16, 200);
  ctx.fillRect(128 - nameW/2, 6, nameW, 30);
  ctx.fillStyle = colorHex; ctx.fillText(name.substring(0, 8), 128, 21);
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(48, 44, 160, 20);
  const hp = Math.max(0, Math.min(100, health));
  ctx.fillStyle = hp > 50 ? '#44ff44' : hp > 25 ? '#ffaa00' : '#ff4444';
  ctx.fillRect(50, 46, 156 * (hp/100), 16);
  ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(Math.round(hp)+'/100', 128, 54);
  sprite.userData.tex.needsUpdate = true;
}
function updatePlayerLabel(sprite, name, color, health) {
  if (!sprite) return;
  const d = sprite.userData.name !== name || sprite.userData.color !== color || sprite.userData.health !== health;
  if (d) { sprite.userData.name = name; sprite.userData.color = color; sprite.userData.health = health; drawPlayerLabel(sprite); }
}

function createPlayerMesh(colorIdx, name) {
  try {
    const group = new THREE.Group();
    const color = MP.PLAYER_COLORS[colorIdx % MP.PLAYER_COLORS.length];
    // 身体：圆柱体
    const bodyGeo = new THREE.CylinderGeometry(0.32, 0.4, 1.1, 10);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
    const body = new THREE.Mesh(bodyGeo, bodyMat); body.position.y = 0.75; group.add(body);
    // 头：球体
    const headGeo = new THREE.SphereGeometry(0.28, 12, 12);
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const head = new THREE.Mesh(headGeo, headMat); head.position.y = 1.55; group.add(head);
    // 脸部方向指示（前面一个小白点，表示朝向）
    const faceGeo = new THREE.BoxGeometry(0.12, 0.08, 0.05);
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const face = new THREE.Mesh(faceGeo, faceMat); face.position.set(0, 1.55, -0.28); group.add(face);
    // 眼睛
    const eyeGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.08, 1.58, -0.26);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.08, 1.58, -0.26);
    group.add(eyeL, eyeR);
    // 名字标签（独立Sprite，始终面向相机）
    const label = createPlayerLabel(name, color, 100);
    label.position.y = 2.3; group.add(label);
    group.userData = { colorIdx, name, body, head, face, label, health: 100, dead: false };
    return group;
  } catch(e) { console.error('createPlayerMesh error:', e); return null; }
}
function setPlayerDead(playerMesh, dead) {
  if (!playerMesh) return;
  playerMesh.userData.dead = dead;
  if (playerMesh.userData.body) playerMesh.userData.body.material.transparent = true, playerMesh.userData.body.material.opacity = dead ? 0.25 : 1;
  if (playerMesh.userData.head) playerMesh.userData.head.material.transparent = true, playerMesh.userData.head.material.opacity = dead ? 0.3 : 1;
  if (playerMesh.userData.face) playerMesh.userData.face.material.transparent = true, playerMesh.userData.face.material.opacity = dead ? 0.3 : 1;
  if (playerMesh.userData.label) playerMesh.userData.label.material.opacity = dead ? 0.4 : 1;
  if (dead) playerMesh.rotation.x = -Math.PI/2; else playerMesh.rotation.x = 0;
}
function removePlayerMesh(player) {
  if (!player || !player.mesh) return;
  try {
    scene.remove(player.mesh);
    player.mesh.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
    });
  } catch(e) {}
}
function updateRemotePlayer(player) {
  if (!player || !player.mesh) return;
  try {
    player.mesh.position.set(player.x, 0, player.z);
    // 朝向：根据yaw旋转（不面向相机）
    player.mesh.rotation.y = player.yaw || 0;
    // label始终面向相机
    if (player.mesh.userData.label) {
      player.mesh.userData.label.lookAt(camera.position);
    }
    updatePlayerLabel(player.mesh.userData.label, player.name, MP.PLAYER_COLORS[player.color], player.health);
  } catch(e) {}
}

function createExtraBot(colorIdx) {
  try {
    const tex = new THREE.TextureLoader().load(NEXTBOT_TEX_DATA, function(t){t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
    const mat = new THREE.MeshBasicMaterial({map:tex,transparent:true,alphaTest:0.1,side:THREE.DoubleSide});
    const geo = new THREE.PlaneGeometry(NEXTBOT_SIZE, NEXTBOT_SIZE);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.y = NEXTBOT_SIZE/2+0.15; scene.add(mesh);
    const glowGeo = new THREE.PlaneGeometry(NEXTBOT_SIZE+0.5, NEXTBOT_SIZE+0.5);
    const glowMat = new THREE.MeshBasicMaterial({color:MP.PLAYER_COLORS[colorIdx],transparent:true,opacity:0.35,side:THREE.BackSide});
    const glowMesh = new THREE.Mesh(glowGeo, glowMat); glowMesh.position.y = NEXTBOT_SIZE/2+0.15; scene.add(glowMesh);
    return { x:0, z:0, mesh, glowMesh, path:[], pathTimer:0, health:100, alive:true, respawnTimer:0, targetId:null, colorIdx };
  } catch(e) { console.error('createExtraBot error:', e); return null; }
}
function removeExtraBot(bot) { if (!bot) return; try { scene.remove(bot.mesh); scene.remove(bot.glowMesh); } catch(e) {} }
function clearExtraBots() { for (const bot of MP.extraBots) removeExtraBot(bot); MP.extraBots = []; }

function hostStartServer() { if (!MP.serverRunning) Bridge.startServer(MP.roomPort); }
function hostStopServer() {
  Bridge.stopBroadcast(); Bridge.stopServer();
  MP.serverRunning = false; MP.mode = 'offline'; cleanupMultiplayer();
}
function hostBroadcastRoom() {
  Bridge.startBroadcast({
    type:'room', host:MP.myName, port:MP.roomPort,
    players:Object.keys(MP.players).length+1, maxPlayers:MP.MAX_PLAYERS,
    mode:MP.selectedMode, inGame:gameRunning,
  });
}
function handleHostMessage(clientId, msg) {
  switch(msg.type) {
    case 'join': {
      if (Object.keys(MP.players).length >= MP.MAX_PLAYERS - 1) {
        Bridge.sendTo(clientId, JSON.stringify({type:'error', message:'房间已满'})); return;
      }
      const colorIdx = getAvailableColor();
      MP.players[clientId] = {
        id:clientId, name:msg.name||'玩家', color:colorIdx,
        x:2*CELL+(Math.random()-0.5)*2, z:5*CELL+(Math.random()-0.5)*2,
        yaw:0, pitch:0, health:MP.MAX_HEALTH, alive:true, dead:false,
        respawnTimer:0, invincible:0, mesh:null,
        input:{dx:0,dy:0,yaw:0,pitch:0,sprint:false,jump:false},
      };
      Bridge.sendTo(clientId, JSON.stringify({
        type:'welcome', id:clientId, color:colorIdx, mode:gameMode, hostName:MP.myName,
        gameRunning:gameRunning,
        settings: { pigSpeed:settings.pigSpeed, noAI:settings.noAI, dayMode:settings.dayMode, gasMode:settings.gasMode },
      }));
      broadcastPlayerList();
      // 客户端加入直接开局（如果游戏在运行）
      if (gameRunning) {
        MP.gameStarted = true; MP.selectedMode = gameMode;
        Bridge.sendTo(clientId, JSON.stringify({type:'startGame', mode:gameMode}));
        sendFullState(clientId);
        syncSettingsTo(clientId);
      }
      break;
    }
    case 'input': {
      if (MP.players[clientId] && MP.gameStarted) {
        MP.players[clientId].input = msg.input;
        MP.players[clientId].yaw = msg.input.yaw;
        MP.players[clientId].pitch = msg.input.pitch;
      }
      break;
    }
    case 'attack': {
      if (MP.gameStarted && MP.players[clientId]) hostProcessAttack(clientId, msg.stage || 1);
      break;
    }
    case 'leave': {
      if (MP.players[clientId]) { removePlayerMesh(MP.players[clientId]); delete MP.players[clientId]; broadcastPlayerList(); }
      break;
    }
  }
}
function getAvailableColor() {
  const used = new Set([0]);
  for (const id in MP.players) used.add(MP.players[id].color);
  for (let i = 0; i < MP.PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
  return 0;
}
function broadcastPlayerList() {
  const list = [{id:'host', name:MP.myName, color:0, isHost:true}];
  for (const id in MP.players) list.push({id, name:MP.players[id].name, color:MP.players[id].color, isHost:false});
  Bridge.broadcast(JSON.stringify({type:'playerList', players:list}));
}
function sendFullState(clientId) { Bridge.sendTo(clientId, JSON.stringify({type:'state', ...buildState()})); }
function syncSettingsTo(clientId) {
  Bridge.sendTo(clientId, JSON.stringify({type:'settings', settings:{
    pigSpeed:settings.pigSpeed, noAI:settings.noAI, dayMode:settings.dayMode, gasMode:settings.gasMode,
  }}));
}
function broadcastSettings() {
  Bridge.broadcast(JSON.stringify({type:'settings', settings:{
    pigSpeed:settings.pigSpeed, noAI:settings.noAI, dayMode:settings.dayMode, gasMode:settings.gasMode,
  }}));
}
function buildState() {
  const players = [{
    id:'host', name:MP.myName, color:0,
    x:player.x, z:player.z, yaw:player.yaw, pitch:player.pitch,
    alive:!MP._hostDead, health:MP._hostHealth, dead:MP._hostDead,
  }];
  for (const id in MP.players) {
    const p = MP.players[id];
    players.push({id, name:p.name, color:p.color, x:p.x, z:p.z, yaw:p.yaw, pitch:p.pitch, alive:p.alive, health:p.health, dead:p.dead});
  }
  const bots = [{x:nextbot.x, z:nextbot.z, alive:nextbot.alive, health:nextbot.health, targetId:'host'}];
  for (const bot of MP.extraBots) bots.push({x:bot.x, z:bot.z, alive:bot.alive, health:bot.health, targetId:bot.targetId, colorIdx:bot.colorIdx});
  const bp = (typeof blackpig !== 'undefined') ? {x:blackpig.x||0, z:blackpig.z||-12, isWatching:!!blackpig.isWatching, isTurning:!!blackpig.isTurning} : null;
  return { time:gameTime, players, bots, gameOver:!gameRunning, mode:gameMode, blackpig:bp };
}
function hostBroadcastState() { Bridge.broadcast(JSON.stringify({type:'state', ...buildState()})); }
function findSafeSpawn() {
  if (gameMode === 'pvp' || gameMode === 'blackpig') {
    return {x:(Math.random()-0.5)*20, z:10+(Math.random()-0.5)*10};
  }
  const candidates = [];
  for (let r = 1; r < MAP_ROWS-1; r++) for (let c = 1; c < MAP_COLS-1; c++) {
    if (MAP[r][c] === 0) {
      const wp = gridToWorld(c, r);
      const dx = nextbot.x - wp.x, dz = nextbot.z - wp.z;
      if (Math.sqrt(dx*dx+dz*dz) > 15) candidates.push({x:wp.x, z:wp.z});
    }
  }
  if (candidates.length === 0) return {x:2*CELL, z:5*CELL};
  return candidates[Math.floor(Math.random()*candidates.length)];
}

function hostUpdateRemotePlayers(dt) {
  for (const id in MP.players) {
    const p = MP.players[id];
    if (p.dead) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        const sp = findSafeSpawn(); p.x=sp.x; p.z=sp.z;
        p.health=MP.MAX_HEALTH; p.dead=false; p.alive=true; p.invincible=MP.INVINCIBLE_TIME;
        if (p.mesh) { setPlayerDead(p.mesh, false); p.mesh.visible = true; }
      }
      continue;
    }
    if (p.invincible > 0) p.invincible -= dt;
    if (MP.gameStarted) {
      const input = p.input;
      // 黑猪模式：黑猪看着时移动=被罚（只罚这个玩家）
      if (gameMode === 'blackpig' && blackpig.isWatching && !blackpig.isTurning) {
        if (Math.abs(input.dx) > 0.01 || Math.abs(input.dy) > 0.01) {
          hostDamagePlayer(id);
        }
        p.yaw = input.yaw; p.pitch = input.pitch;
        continue;
      }
      const speed = input.sprint ? SPRINT_SPEED : PLAYER_SPEED;
      const fwd = {x:-Math.sin(input.yaw), z:-Math.cos(input.yaw)};
      const right = {x:Math.cos(input.yaw), z:-Math.sin(input.yaw)};
      const mx = (fwd.x*input.dy + right.x*input.dx)*speed*dt;
      const mz = (fwd.z*input.dy + right.z*input.dx)*speed*dt;
      if (gameMode === 'pvp' || gameMode === 'blackpig') {
        p.x += mx; p.z += mz;
        const half = 30;
        p.x = Math.max(-half, Math.min(half, p.x));
        p.z = Math.max(-half+8, Math.min(half, p.z));
      } else {
        const nx = p.x+mx; if (!collides(nx,p.z,PLAYER_RADIUS) || settings.noclip) p.x = nx;
        const nz = p.z+mz; if (!collides(p.x,nz,PLAYER_RADIUS) || settings.noclip) p.z = nz;
      }
      p.yaw = input.yaw; p.pitch = input.pitch;
    }
    if (!p.mesh && scene) { p.mesh = createPlayerMesh(p.color, p.name); if (p.mesh) scene.add(p.mesh); }
    if (p.mesh) updateRemotePlayer(p);
  }
}

function hostUpdateBots(dt) {
  if (gameMode !== 'hunt' && gameMode !== 'normal') return;
  const totalPlayers = 1 + Object.keys(MP.players).length;
  while (MP.extraBots.length < totalPlayers - 1) {
    const idx = MP.extraBots.length + 1;
    const bot = createExtraBot(idx % MP.PLAYER_COLORS.length);
    if (bot) { bot.x = 14*CELL+(Math.random()-0.5)*4; bot.z = 1*CELL+(Math.random()-0.5)*4; MP.extraBots.push(bot); }
    else break;
  }
  const playerIds = ['host', ...Object.keys(MP.players)];
  MP.extraBots.forEach((bot, i) => { bot.targetId = playerIds[(i+1) % playerIds.length]; });
  for (const bot of MP.extraBots) {
    if (!bot.alive) {
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) {
        bot.alive = true; bot.health = 100;
        bot.x = 14*CELL+(Math.random()-0.5)*4; bot.z = 1*CELL+(Math.random()-0.5)*4;
        bot.mesh.visible = true; bot.glowMesh.visible = true;
      }
      continue;
    }
    let tx, tz;
    if (bot.targetId === 'host') { tx = player.x; tz = player.z; }
    else if (MP.players[bot.targetId]) { tx = MP.players[bot.targetId].x; tz = MP.players[bot.targetId].z; }
    else { tx = player.x; tz = player.z; }
    const nextbotSpeed = BASE_NEXTBOT_SPEED * settings.pigSpeed;
    if (!settings.noAI) {
      bot.pathTimer -= dt;
      if (bot.pathTimer <= 0 || bot.path.length === 0) {
        const from = worldToGrid(bot.x, bot.z); const to = worldToGrid(tx, tz);
        bot.path = astar(from.r, from.c, to.r, to.c); bot.pathTimer = 0.4;
      }
      let mx, mz;
      if (bot.path.length > 1) {
        const np = bot.path[1]; const wp = gridToWorld(np.c, np.r);
        mx = wp.x; mz = wp.z;
        if (Math.sqrt((bot.x-wp.x)**2+(bot.z-wp.z)**2) < 0.8) bot.path.shift();
      } else { mx = tx; mz = tz; }
      const ndx = mx-bot.x, ndz = mz-bot.z, nd = Math.sqrt(ndx*ndx+ndz*ndz);
      if (nd > 0.1) { bot.x += (ndx/nd)*nextbotSpeed*dt; bot.z += (ndz/nd)*nextbotSpeed*dt; }
    }
    bot.mesh.position.set(bot.x, NEXTBOT_SIZE/2+0.15, bot.z);
    bot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    bot.glowMesh.position.copy(bot.mesh.position);
    bot.glowMesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    const targetX = bot.targetId === 'host' ? player.x : (MP.players[bot.targetId]?.x ?? player.x);
    const targetZ = bot.targetId === 'host' ? player.z : (MP.players[bot.targetId]?.z ?? player.z);
    const dx = bot.x - targetX, dz = bot.z - targetZ;
    if (Math.sqrt(dx*dx+dz*dz) < NEXTBOT_SIZE*0.55+PLAYER_RADIUS) {
      if (bot.targetId === 'host') hostOnHostHit();
      else if (MP.players[bot.targetId]) hostDamagePlayer(bot.targetId);
    }
  }
}

function hostProcessAttack(clientId, stage) {
  const attacker = MP.players[clientId]; if (!attacker) return;
  const dmg = stage === 1 ? 15 : stage === 2 ? 20 : 30;
  if (gameMode === 'pvp') {
    // PVP：攻击其他玩家
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    const targets = [{id:'host', x:player.x, z:player.z, obj:null, isHost:true}];
    for (const id in MP.players) {
      if (id === clientId) continue;
      const p = MP.players[id];
      if (p && !p.dead) targets.push({id, x:p.x, z:p.z, obj:p, isHost:false});
    }
    for (const t of targets) {
      const dx = t.x - attacker.x, dz = t.z - attacker.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist > 3.5) continue;
      const toT = {x:dx/dist, z:dz/dist};
      if (fwd.x*toT.x + fwd.z*toT.z < 0.4) continue;
      if (t.isHost) {
        if (hostOnHostHit()) {}
      } else if (t.obj && t.obj.invincible <= 0) {
        t.obj.health -= dmg; t.obj.invincible = 0.5;
        if (t.obj.health <= 0) {
          t.obj.health = 0; t.obj.dead = true; t.obj.alive = false;
          t.obj.respawnTimer = MP.RESPAWN_TIME;
          if (t.obj.mesh) setPlayerDead(t.obj.mesh, true);
        }
      }
    }
    return;
  }
  if (gameMode !== 'hunt') return;
  const allBots = [nextbot, ...MP.extraBots];
  for (const bot of allBots) {
    if (!bot.alive) continue;
    const dx = bot.x - attacker.x, dz = bot.z - attacker.z;
    const dist = Math.sqrt(dx*dx+dz*dz);
    if (dist > 4) continue;
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    const toBot = {x:dx/dist, z:dz/dist};
    if (fwd.x*toBot.x + fwd.z*toBot.z < 0.3) continue;
    bot.health -= dmg;
    if (bot.health <= 0) {
      bot.alive = false; bot.respawnTimer = 3;
      if (bot.mesh) bot.mesh.visible = false;
      if (bot.glowMesh) bot.glowMesh.visible = false;
    }
  }
}
function hostDamagePlayer(clientId) {
  const p = MP.players[clientId];
  if (!p || p.dead || p.invincible > 0) return;
  if (gameMode === 'normal' || gameMode === 'blackpig') {
    // 普通/黑猪模式：一击必杀
    p.health = 0; p.dead = true; p.alive = false; p.respawnTimer = MP.RESPAWN_TIME;
    if (p.mesh) setPlayerDead(p.mesh, true);
  } else {
    // 打猪/PVP：扣血
    p.health -= 15; p.invincible = 0.8;
    if (p.health <= 0) { p.health = 0; p.dead = true; p.alive = false; p.respawnTimer = MP.RESPAWN_TIME; if (p.mesh) setPlayerDead(p.mesh, true); }
  }
}
function hostUpdateHostHealth(dt) {
  if (MP._hostDead) {
    MP._hostRespawnTimer -= dt;
    if (MP._hostRespawnTimer <= 0) {
      const sp = findSafeSpawn(); player.x=sp.x; player.z=sp.z;
      MP._hostHealth=MP.MAX_HEALTH; MP._hostDead=false; MP._hostInvincible=MP.INVINCIBLE_TIME;
      playerHealth = MP.MAX_HEALTH; if (typeof updateHealthUI === 'function') updateHealthUI();
    }
    return;
  }
  if (MP._hostInvincible > 0) MP._hostInvincible -= dt;
}
function hostOnHostHit() {
  if (MP._hostDead || MP._hostInvincible > 0) return false;
  if (gameMode === 'normal' || gameMode === 'blackpig') {
    // 普通/黑猪模式：一击必杀
    MP._hostHealth = 0; MP._hostDead = true; MP._hostRespawnTimer = MP.RESPAWN_TIME;
    playerHealth = 0; if (typeof updateHealthUI === 'function') updateHealthUI();
  } else {
    // 打猪/PVP：扣血
    MP._hostHealth -= 15; MP._hostInvincible = 0.8; playerHealth = MP._hostHealth;
    if (typeof updateHealthUI === 'function') updateHealthUI();
    if (MP._hostHealth <= 0) {
      MP._hostHealth = 0; MP._hostDead = true; MP._hostRespawnTimer = MP.RESPAWN_TIME;
      playerHealth = 0; if (typeof updateHealthUI === 'function') updateHealthUI();
    }
  }
  return true;
}

function clientConnect(ip, port) { MP.mode = 'client'; Bridge.connect(ip, port); }
function clientDisconnect() {
  try { Bridge.send(JSON.stringify({type:'leave'})); } catch(e) {}
  Bridge.disconnect(); MP.connected = false; MP.mode = 'offline'; cleanupMultiplayer();
}
function handleClientMessage(msg) {
  switch(msg.type) {
    case 'welcome': {
      MP.myId = msg.id; MP.myColor = msg.color; MP.selectedMode = msg.mode;
      if (msg.settings) applyRemoteSettings(msg.settings);
      if (MP.onJoined) MP.onJoined(msg);
      // welcome里带了游戏状态，直接进游戏，不等startGame消息
      if (msg.gameRunning && msg.mode) {
        MP.gameStarted = true;
        if (MP.onGameStart) MP.onGameStart(msg.mode);
      }
      break;
    }
    case 'playerList': {
      MP.playerList = msg.players;
      if (MP.onPlayerListUpdate) MP.onPlayerListUpdate(msg.players);
      break;
    }
    case 'settings': { applyRemoteSettings(msg.settings); break; }
    case 'state': { clientApplyState(msg); break; }
    case 'startGame': {
      MP.gameStarted = true; MP.selectedMode = msg.mode;
      if (MP.onGameStart) MP.onGameStart(msg.mode);
      break;
    }
    case 'gameOver': { if (gameRunning) gameOver('caught'); break; }
    case 'error': { if (MP.onError) MP.onError(msg.message); break; }
  }
}
function applyRemoteSettings(s) {
  if (!s) return;
  if (s.pigSpeed !== undefined) { settings.pigSpeed = s.pigSpeed; document.getElementById('pigSpeedVal').textContent = s.pigSpeed; document.getElementById('pigSpeedSlider').value = s.pigSpeed; }
  if (s.noAI !== undefined) settings.noAI = s.noAI;
  if (s.dayMode !== undefined) { settings.dayMode = s.dayMode; if (typeof applyDayMode === 'function') applyDayMode(); }
  if (s.gasMode !== undefined) {
    settings.gasMode = s.gasMode;
    if (s.gasMode && typeof enableGasEffect === 'function') enableGasEffect();
    else if (typeof disableGasEffect === 'function') disableGasEffect();
  }
}
function clientApplyState(state) {
  if (!MP.gameStarted) return;
  gameTime = state.time || 0;
  document.getElementById('hud').textContent = formatTime(gameTime);
  if (state.bots && state.bots.length > 0) {
    const mainBot = state.bots[0];
    nextbot.x = mainBot.x; nextbot.z = mainBot.z; nextbot.alive = mainBot.alive; nextbot.health = mainBot.health;
    if (nextbot.mesh) {
      nextbot.mesh.visible = nextbot.alive;
      nextbot.mesh.position.set(nextbot.x, NEXTBOT_SIZE/2+0.15, nextbot.z);
      nextbot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    }
    if (nextbot.glowMesh) { nextbot.glowMesh.visible = nextbot.alive; if (nextbot.mesh) nextbot.glowMesh.position.copy(nextbot.mesh.position); }
    if (gameMode === 'hunt' || gameMode === 'normal') {
      while (MP.extraBots.length < state.bots.length - 1) {
        const idx = MP.extraBots.length + 1;
        const bot = createExtraBot(idx % MP.PLAYER_COLORS.length);
        if (bot) MP.extraBots.push(bot); else break;
      }
      for (let i = 1; i < state.bots.length; i++) {
        const bot = MP.extraBots[i-1]; if (!bot) continue;
        const bd = state.bots[i];
        bot.x = bd.x; bot.z = bd.z; bot.alive = bd.alive; bot.health = bd.health;
        bot.mesh.visible = bot.alive; bot.glowMesh.visible = bot.alive;
        if (bot.alive) {
          bot.mesh.position.set(bot.x, NEXTBOT_SIZE/2+0.15, bot.z);
          bot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
          bot.glowMesh.position.copy(bot.mesh.position);
        }
      }
    }
  }
  const seenIds = new Set();
  for (const pdata of (state.players || [])) {
    seenIds.add(pdata.id);
    if (pdata.id === MP.myId) {
      player.x = pdata.x; player.z = pdata.z; player.yaw = pdata.yaw; player.pitch = pdata.pitch;
      playerHealth = pdata.health; if (typeof updateHealthUI === 'function') updateHealthUI();
      if (pdata.dead && !MP._clientDead) { MP._clientDead = true; showDeathOverlay(); }
      else if (!pdata.dead && MP._clientDead) { MP._clientDead = false; hideDeathOverlay(); }
      continue;
    }
    let rp = MP.remotePlayers[pdata.id];
    if (!rp) {
      rp = {id:pdata.id, name:pdata.name, color:pdata.color, mesh:createPlayerMesh(pdata.color, pdata.name),
        x:pdata.x, z:pdata.z, yaw:pdata.yaw, health:pdata.health, dead:pdata.dead,
        targetX:pdata.x, targetZ:pdata.z, targetYaw:pdata.yaw};
      if (rp.mesh) scene.add(rp.mesh);
      MP.remotePlayers[pdata.id] = rp;
    }
    rp.targetX = pdata.x; rp.targetZ = pdata.z; rp.targetYaw = pdata.yaw;
    rp.name = pdata.name; rp.health = pdata.health; rp.dead = pdata.dead;
    if (rp.mesh) { setPlayerDead(rp.mesh, pdata.dead); updatePlayerLabel(rp.mesh.userData.label, pdata.name, MP.PLAYER_COLORS[pdata.color], pdata.health); }
  }
  for (const id in MP.remotePlayers) {
    if (!seenIds.has(id)) { if (MP.remotePlayers[id].mesh) scene.remove(MP.remotePlayers[id].mesh); delete MP.remotePlayers[id]; }
  }
  // 黑猪模式：同步黑猪位置和朝向
  if (gameMode === 'blackpig' && state.blackpig && typeof blackpig !== 'undefined') {
    blackpig.x = state.blackpig.x; blackpig.z = state.blackpig.z;
    const wasWatching = blackpig.isWatching;
    blackpig.isWatching = state.blackpig.isWatching;
    blackpig.isTurning = state.blackpig.isTurning;
    if (blackpig.mesh) {
      blackpig.mesh.position.set(blackpig.x, 6, blackpig.z);
      if (blackpig.isWatching !== wasWatching) {
        // 朝向变化时更新材质，纹理没加载完就用颜色区分
        if (blackpig.isWatching) {
          if (blackpig.frontTex) blackpig.mesh.material.map = blackpig.frontTex;
          blackpig.mesh.material.color.setHex(0xff4444);
        } else {
          if (blackpig.backTex) blackpig.mesh.material.map = blackpig.backTex;
          blackpig.mesh.material.color.setHex(0x4444ff);
        }
        blackpig.mesh.material.needsUpdate = true;
      }
    }
    if (typeof updateBlackpigStatusUI === 'function') updateBlackpigStatusUI();
  }
  if (state.gameOver && gameRunning) gameOver('caught');
}
function clientUpdateRemotePlayers(dt) {
  for (const id in MP.remotePlayers) {
    const rp = MP.remotePlayers[id];
    rp.x += (rp.targetX - rp.x) * Math.min(1, dt*10);
    rp.z += (rp.targetZ - rp.z) * Math.min(1, dt*10);
    // yaw插值，处理角度环绕
    let dyaw = rp.targetYaw - rp.yaw;
    while (dyaw > Math.PI) dyaw -= 2*Math.PI;
    while (dyaw < -Math.PI) dyaw += 2*Math.PI;
    rp.yaw += dyaw * Math.min(1, dt*10);
    if (rp.mesh) {
      rp.mesh.position.set(rp.x, 0, rp.z);
      if (!rp.dead) rp.mesh.rotation.y = rp.yaw;
      if (rp.mesh.userData.label) rp.mesh.userData.label.lookAt(camera.position);
    }
  }
}
function clientSendInput() {
  if (MP.mode !== 'client' || !MP.connected || !MP.gameStarted) return;
  const now = Date.now();
  if (now - MP.lastInputSend < 80) return;
  MP.lastInputSend = now;
  Bridge.send(JSON.stringify({type:'input', input:{
    dx:joystick.dx, dy:joystick.dy, yaw:player.yaw, pitch:player.pitch,
    sprint:sprintActive, jump:!player.onGround,
  }}));
}
function clientSendAttack(stage) {
  if (MP.mode !== 'client' || !MP.connected) return;
  Bridge.send(JSON.stringify({type:'attack', stage}));
}
function showDeathOverlay() {
  let el = document.getElementById('mpDeathOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'mpDeathOverlay';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(180,0,0,0.4);z-index:60;pointer-events:none;display:flex;align-items:center;justify-content:center;';
    el.innerHTML = '<div style="text-align:center;color:#fff;font-size:36px;font-weight:bold;text-shadow:0 0 12px #000;">你被抓到了<br><span style="font-size:20px;">复活中...</span></div>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}
function hideDeathOverlay() { const el = document.getElementById('mpDeathOverlay'); if (el) el.style.display = 'none'; }

function startRoomScan() {
  MP.foundRooms = []; Bridge.startScan();
  MP.scanTimer = setInterval(() => {
    const now = Date.now();
    MP.foundRooms = MP.foundRooms.filter(r => now - r._lastSeen < 5000);
    if (MP.onRoomListUpdate) MP.onRoomListUpdate(MP.foundRooms);
  }, 1000);
}
function stopRoomScan() { Bridge.stopScan(); if (MP.scanTimer) { clearInterval(MP.scanTimer); MP.scanTimer = null; } }

function cleanupMultiplayer() {
  for (const id in MP.players) removePlayerMesh(MP.players[id]);
  MP.players = {};
  for (const id in MP.remotePlayers) { if (MP.remotePlayers[id].mesh) scene.remove(MP.remotePlayers[id].mesh); }
  MP.remotePlayers = {};
  clearExtraBots();
  MP.gameStarted = false; MP.connected = false;
  MP._hostHealth = 100; MP._hostDead = false; MP._hostRespawnTimer = 0; MP._hostInvincible = 0;
  MP._clientDead = false; hideDeathOverlay();
}

function mpUpdate(dt) {
  if (MP.mode === 'host') {
    hostUpdateHostHealth(dt);
    hostUpdateRemotePlayers(dt);
    if (gameMode === 'hunt' || gameMode === 'normal') hostUpdateBots(dt);
    const now = Date.now();
    if (now - MP.lastStateBroadcast > 100) { MP.lastStateBroadcast = now; if (MP.gameStarted) hostBroadcastState(); }
  } else if (MP.mode === 'client') {
    clientSendInput();
    clientUpdateRemotePlayers(dt);
  }
}
function mpOnGameStart(mode) {
  MP.gameStarted = true; MP.selectedMode = mode;
  MP._hostHealth = 100; MP._hostDead = false; MP._hostInvincible = 0;
  clearExtraBots();
  if (MP.mode === 'host') {
    for (const id in MP.players) {
      const p = MP.players[id];
      const sp = findSafeSpawn(); p.x=sp.x; p.z=sp.z;
      p.health=MP.MAX_HEALTH; p.dead=false; p.alive=true; p.respawnTimer=0; p.invincible=0;
      if (p.mesh) { setPlayerDead(p.mesh, false); p.mesh.visible = true; }
    }
    Bridge.broadcast(JSON.stringify({type:'startGame', mode}));
    hostBroadcastRoom();
  }
}
function mpOnGameOver() { if (MP.mode === 'host') { hostBroadcastState(); Bridge.broadcast(JSON.stringify({type:'gameOver'})); } }
function mpOnReturnMenu() {
  if (MP.mode === 'host') hostStopServer();
  else if (MP.mode === 'client') clientDisconnect();
  cleanupMultiplayer();
}
console.log('[Multiplayer V2] loaded');
