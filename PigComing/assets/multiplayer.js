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
  // 打福瑞模式：多人重生更短（3秒），其余模式保持5秒
  getRespawnTime() {
    return (typeof gameMode !== 'undefined' && gameMode === 'survival') ? 3 : this.RESPAWN_TIME;
  },
  INVINCIBLE_TIME: 3,
  extraBots: [],
  _hostHealth: 100, _hostDead: false, _hostRespawnTimer: 0, _hostInvincible: 0,
  _clientDead: false,
  // === 网络加固：断线重连 ===
  _reconnectAttempts: 0,
  _reconnectMaxAttempts: 5,
  _reconnectDelay: 1000,
  _lastConnectedIp: null,
  _lastConnectedPort: null,
  _reconnectTimer: null,
  // === 网络加固：握手验证 ===
  _handshakeToken: null,
  // === 带宽优化状态 ===
  _lastInputSig: null,   // 上次发送的输入签名
  _lastStateJson: null,  // 上次广播的状态JSON（无变化跳过）
  _prevAlive: null,      // 客户端死亡检测快照
  _jumpSent: false,      // 客户端跳跃上升沿检测：防止重复发送jump
  // === Ping延迟测量 ===
  ping: 0,               // 当前RTT延迟(ms)
  _lastInputTime: 0,     // 客户端最近一次发送输入的Date.now()
  _hostEchoTime: 0,      // 主机回传的客户端时间戳
  _pingSent: 0,          // 专用ping消息发送时间
  _pingSeq: 0,           // ping序列号
  _lastPingSend: 0,      // 上次发送ping的时间
  _lastBandwidthCalc: 0, // 上次计算带宽的时间
  _clientLastInput: {},  // 主机记录各客户端最后输入时间（超时检测）
  // === 带宽统计 ===
  bytesSent: 0,          // 本会话累计发送字节
  bytesRecv: 0,          // 本会话累计接收字节
  _bytesSentWindow: 0,   // 1秒窗口内发送字节
  _bytesRecvWindow: 0,   // 1秒窗口内接收字节
  sendKBps: 0,           // 当前发送速率 KB/s
  recvKBps: 0,           // 当前接收速率 KB/s
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
    if (MP.players[clientId]) {
      const p = MP.players[clientId];
      if (p._chairIdx !== undefined && typeof deskChairs !== 'undefined' && deskChairs[p._chairIdx]) {
        const ch = deskChairs[p._chairIdx];
        if (ch.occupiedBy === clientId) { ch.occupiedBy = null; ch.isSitting = false; }
      }
      removePlayerMesh(p); delete MP.players[clientId]; broadcastPlayerList(); if (MP.onPlayerLeave) MP.onPlayerLeave(clientId);
    }
  },
  onMessage(clientId, msgStr) {
    try { handleHostMessage(clientId, JSON.parse(msgStr)); } catch(e) { console.error('[MP] parse:', e); }
  },
  onConnected() { MP.connected = true; hideReconnectOverlay(); if (MP.onConnected) MP.onConnected(); },
  onDisconnected() {
    MP.connected = false; MP.ping = 0; MP.mode = 'offline';
    hideReconnectOverlay();
    cleanupMultiplayer();
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
    // 插值平滑移动（lerp factor 0.15，平衡响应速度和平滑度）
    const lerpFactor = 0.25;
    if (player.targetX !== undefined) {
      player.x += (player.targetX - player.x) * lerpFactor;
      player.z += (player.targetZ - player.z) * lerpFactor;
      // yaw插值，处理角度环绕
      let dyaw = (player.targetYaw || 0) - player.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      player.yaw += dyaw * lerpFactor;
    }
    // 跳跃Y值插值
    if (player.targetJumpY !== undefined) {
      player.jumpY = player.jumpY || 0;
      player.jumpY += (player.targetJumpY - player.jumpY) * lerpFactor;
    }
    player.mesh.position.set(player.x, player.jumpY || 0, player.z);
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
  // === 握手验证：除join/leave外必须带有效token，防止伪造消息 ===
  if (msg.type !== 'join' && msg.type !== 'leave') {
    const player = MP.players[clientId];
    if (!player || !player._token || !msg.token || msg.token !== player._token) {
      console.warn('[MP] Rejected unauthorized message from client:', clientId, msg.type);
      Bridge.sendTo(clientId, JSON.stringify({type:'error', message:'验证失败'}));
      return;
    }
  }
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
        points:0,                                              // 打福瑞模式独立积分
        buffs:{speedUntil:0, damageUntil:0, invincibleUntil:0}, // 道具buff（gameTime时间戳）
        dev:null,                                              // 该客户端的开发者作弊状态
        input:{dx:0,dy:0,yaw:0,pitch:0,sprint:false,jump:false},
        jumpSent:false,                                        // 跳跃上升沿检测：防止客户端重复发送jump导致飞天
      };
      // === 握手验证：生成token ===
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      MP.players[clientId]._token = token;
      Bridge.sendTo(clientId, JSON.stringify({
        type:'welcome', id:clientId, color:colorIdx, mode:MP.selectedMode, hostName:MP.myName,
        gameRunning:gameRunning, token:token,
        srtPlayerId: window._srtSelectedSrt || null,
        hideSeekerId: window._hideSelectedSeeker || null,
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
      // 通知UI有新玩家加入（SRT大厅等界面依赖此回调刷新）
      if (MP.onPlayerJoin) MP.onPlayerJoin(clientId);
      break;
    }
    case 'input': {
      if (MP.players[clientId] && MP.gameStarted) {
        MP.players[clientId].input = msg.input;
        MP.players[clientId].yaw = msg.input.yaw;
        MP.players[clientId].pitch = msg.input.pitch;
        MP.players[clientId]._lastInputTime = Date.now();
        // Ping回传：客户端发送的时间戳原样回传，客户端据此计算RTT
        if (msg._ts) MP.players[clientId]._echoTs = msg._ts;
      }
      break;
    }
    case 'ping': {
      // 客户端发来的ping测量，立即回传
      Bridge.sendTo(clientId, JSON.stringify({type:'pong', ts:msg.ts}));
      break;
    }
    case 'attack': {
      if (MP.gameStarted && MP.players[clientId]) {
        // === 作弊模式验证：特殊token标记 ===
        let dmgOverride = 0;
        let msgAutoAim = false;
        if (msg.cheatToken === 'DEV_CHEAT_ACTIVE' && msg.cheatDamage) {
          dmgOverride = Math.min(msg.cheatDamage, 999);
          msgAutoAim = msg.autoAim === true; // 客户端自动锁敌
        }
        hostProcessAttack(clientId, msg.stage || 1, dmgOverride, msgAutoAim);
      }
      break;
    }
    case 'srtReady': {
      if (MP.gameStarted && gameMode === 'srt' && window._srtSelectedSrt === clientId) {
        srt.state = 'running';
        if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
        srtAudio.loop = true; srtAudio.volume = 0.8; srtAudio.play().catch(()=>{});
      }
      break;
    }
    case 'shopBuy': {
      // 打福瑞模式：客户端用自己的独立积分购买道具（道具本体在客户端本地物品栏，主机只管积分）
      if (MP.gameStarted && gameMode === 'survival' && MP.players[clientId] && typeof SURVIVAL !== 'undefined') {
        const item = SURVIVAL.SHOP_ITEMS.find(i => i.id === msg.itemId);
        const p = MP.players[clientId];
        if (item && (p.points || 0) >= item.price) {
          p.points -= item.price;
        }
      }
      break;
    }
    case 'itemUse': {
      // 打福瑞模式：客户端使用道具，世界效果由主机执行（积分记到使用者）
      if (MP.gameStarted && gameMode === 'survival' && MP.players[clientId]) {
        if (typeof applySurvivalItemEffect === 'function') applySurvivalItemEffect(msg.itemId, clientId);
      }
      break;
    }
    case 'devCheat': {
      // 开发者作弊联机同步：主机记录该客户端的作弊状态并按其生效
      const p = MP.players[clientId];
      if (p && msg.dev) {
        p.dev = {
          active: !!msg.dev.active,
          speed: !!msg.dev.speed,
          speedMult: Math.max(1, Math.min(20, parseFloat(msg.dev.speedMult) || 2)),
          invincible: !!msg.dev.invincible,
          autoAim: !!msg.dev.autoAim,
        };
        console.log('[MP] client devCheat:', clientId, JSON.stringify(p.dev));
      }
      break;
    }
    case 'leave': {
      if (MP.players[clientId]) {
        const p = MP.players[clientId];
        if (p._chairIdx !== undefined && typeof deskChairs !== 'undefined' && deskChairs[p._chairIdx]) {
          const ch = deskChairs[p._chairIdx];
          if (ch.occupiedBy === clientId) { ch.occupiedBy = null; ch.isSitting = false; }
        }
        removePlayerMesh(p); delete MP.players[clientId]; broadcastPlayerList(); if (MP.onPlayerLeave) MP.onPlayerLeave(clientId);
      }
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
  // 数值量化：坐标2位小数、时间整秒 —— 静止时生成完全相同的JSON，配合跳过逻辑大幅省流量
  const r2 = v => Math.round(v * 100) / 100;
  // 黑猪模式：房主所坐的椅子索引（-1=没坐）
  let hostChairIdx = -1;
  if (gameMode === 'blackpig' && typeof deskChairs !== 'undefined') {
    hostChairIdx = deskChairs.findIndex(c => c.occupiedBy === 'self');
  }
  // 打福瑞模式：附带各玩家独立积分
  const survivalPoints = (gameMode === 'survival');
  const players = [{
    id:'host', name:MP.myName, color:0,
    x:r2(player.x), z:r2(player.z), jumpY:r2(player.jumpY||0), yaw:r2(player.yaw), pitch:r2(player.pitch),
    alive:!MP._hostDead, health:MP._hostHealth, dead:MP._hostDead, chairIdx:hostChairIdx,
    ...(survivalPoints ? {points: survival.points || 0} : {}),
  }];
  for (const id in MP.players) {
    const p = MP.players[id];
    players.push({id, name:p.name, color:p.color, x:r2(p.x), z:r2(p.z), jumpY:r2(p.jumpY||0), yaw:r2(p.yaw), pitch:r2(p.pitch), alive:p.alive, health:p.health, dead:p.dead, chairIdx: (p._chairIdx !== undefined ? p._chairIdx : -1),
      echoTs: p._echoTs || 0,  // Ping回传：客户端发送时间戳
      ...(survivalPoints ? {points: p.points || 0} : {})});
  }
  const bots = [{x:r2(nextbot.x), z:r2(nextbot.z), alive:nextbot.alive, health:nextbot.health, targetId:'host'}];
  for (const bot of MP.extraBots) bots.push({x:r2(bot.x), z:r2(bot.z), alive:bot.alive, health:bot.health, targetId:bot.targetId, colorIdx:bot.colorIdx});
  const bp = (typeof blackpig !== 'undefined') ? {x:r2(blackpig.x||0), z:r2(blackpig.z||-12), isWatching:!!blackpig.isWatching, isTurning:!!blackpig.isTurning} : null;
  // SRT模式状态同步
  let srtState = null;
  if (gameMode === 'srt' && typeof srt !== 'undefined' && srt.mesh) {
    srtState = {
      x: r2(srt.x), z: r2(srt.z), health: srt.health, alive: srt.alive,
      hasFrog: !!srt.hasFrog, state: srt.state,
      escapeTimer: Math.round(srt.escapeTimer || 0),
      frogX: r2(srtFrog.x), frogZ: r2(srtFrog.z), frogCollected: !!srtFrog.collected, frogVisible: srtFrog.mesh ? srtFrog.mesh.visible : false,
      srtPlayerId: window._srtSelectedSrt || null,
    };
  }
  // 生存模式状态同步（客户端据此渲染猪和HUD）
  let survivalState = null;
  if (gameMode === 'survival' && typeof survival !== 'undefined') {
    survivalState = {
      wave: survival.wave, points: survival.points, totalKills: survival.totalKills,
      waveActive: survival.waveActive, wavePigsRemaining: survival.wavePigsRemaining,
      waveDelay: Math.round(survival.waveDelay * 10) / 10,
      pigs: survival.pigs.map(p => ({x:r2(p.x), z:r2(p.z), alive:p.alive, health:p.health})),
    };
  }
  // 捉迷藏模式状态同步
  let hideState = null;
  if (gameMode === 'hide') {
    hideState = { phase: hide.phase, timer: Math.max(0, Math.round(hide.timer * 10) / 10), seekerId: hide.seeker };
  }
  return { time: Math.floor(gameTime), players, bots, gameOver:!gameRunning, mode:gameMode, blackpig:bp, srt:srtState, survival:survivalState, hide:hideState };
}
function hostBroadcastState() {
  const json = JSON.stringify({type:'state', ...buildState()});
  // 带宽优化：状态无变化时跳过广播（躲藏者静止时流量趋近于0）
  if (json === MP._lastStateJson) return;
  MP._lastStateJson = json;
  MP.bytesSent += json.length;
  MP._bytesSentWindow += json.length;
  Bridge.broadcast(json);
}
function findSafeSpawn() {
  if (gameMode === 'pvp' || gameMode === 'blackpig') {
    return {x:(Math.random()-0.5)*20, z:10+(Math.random()-0.5)*10};
  }
  if (gameMode === 'hide') {
    // 捉迷藏：躲藏者远离抓捕者出生点（0,-24）且不与任何墙壁/建筑碰撞
    const seekerX = 0, seekerZ = -26;
    for (let t = 0; t < 50; t++) {
      const sx = (Math.random()-0.5) * (HIDE_FIELD - 16);
      const sz = (Math.random()-0.5) * (HIDE_FIELD - 16);
      // 距离抓捕者出生点至少20米
      if (Math.sqrt((sx-seekerX)**2 + (sz-seekerZ)**2) < 20) continue;
      // 碰撞检测：不与任何墙壁/建筑重叠
      if (typeof hideCollides === 'function' && hideCollides(sx, sz, PLAYER_RADIUS + 0.5)) continue;
      return {x:sx, z:sz};
    }
    // 兜底：场地中央偏右的安全位置
    return {x:10, z:10};
  }
  if (gameMode === 'survival') {
    // 生存模式：空旷场地内随机点，远离所有猪
    const half = (typeof SURVIVAL !== 'undefined' ? SURVIVAL.FIELD_SIZE : 60)/2 - 4;
    for (let tries = 0; tries < 20; tries++) {
      const sx = (Math.random()-0.5)*half*1.6, sz = (Math.random()-0.5)*half*1.6;
      let minD = Infinity;
      for (const pig of survival.pigs) {
        if (!pig.alive) continue;
        const d = Math.sqrt((pig.x-sx)**2 + (pig.z-sz)**2);
        if (d < minD) minD = d;
      }
      if (minD > 10 || !isFinite(minD)) return {x:sx, z:sz};
    }
    return {x:0, z:0};
  }
  if (gameMode === 'srt') {
    // SRT场地内随机出生，避开SRT和青蛙
    const half = (typeof SRT_FIELD_SIZE !== 'undefined' ? SRT_FIELD_SIZE : 60)/2 - 4;
    let sx, sz, tries = 0;
    do {
      sx = (Math.random()-0.5)*half*1.6;
      sz = (Math.random()-0.5)*half*1.6;
      tries++;
      const dSrt = Math.sqrt((sx-srt.x)**2+(sz-srt.z)**2);
      const dFrog = Math.sqrt((sx-srtFrog.x)**2+(sz-srtFrog.z)**2);
      if (dSrt > 8 && dFrog > 5) break;
    } while (tries < 20);
    return {x:sx, z:sz};
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
      // 捉迷藏：出局者不复活，尸体位置持续同步
      if (gameMode === 'hide') { if (p.mesh) updateRemotePlayer(p); continue; }
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        const sp = findSafeSpawn(); p.x=sp.x; p.z=sp.z;
        p.dead=false; p.alive=true; p.health=MP.MAX_HEALTH; p.invincible=MP.INVINCIBLE_TIME;
        if (p.mesh) { setPlayerDead(p.mesh, false); p.mesh.visible = true; }
        // 客户端复活后重置所有猪路径，让猪直接重新追
        if (gameMode === 'normal' || gameMode === 'hunt') {
          nextbot.path = []; nextbot.pathTimer = 0;
          for (const bot of MP.extraBots) { bot.path = []; bot.pathTimer = 0; }
          if (typeof nextbotAudio !== 'undefined' && nextbotAudio) { try { nextbotAudio.currentTime = 0; nextbotAudio.play().catch(()=>{}); } catch(e){} }
        }
        // 打福瑞模式：复活后重新分配猪的目标（否则死前盯着它的猪仍追旧目标，且孤儿猪全涌向房主）
        if (gameMode === 'survival' && typeof assignPigTargets === 'function') {
          assignPigTargets();
        }
      }
      continue;
    }
    if (p.invincible > 0) p.invincible -= dt;
    if (MP.gameStarted) {
      if (!p.buffs) p.buffs = { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
      const input = p.input;
      // 黑猪模式：椅子占用管理（先于判罚处理，保证坐着的玩家位置正确）
      if (gameMode === 'blackpig' && typeof deskChairs !== 'undefined') {
        if (p._chairIdx !== undefined && p._chairIdx !== input.chairIdx) {
          const oldCh = deskChairs[p._chairIdx];
          if (oldCh && oldCh.occupiedBy === id) { oldCh.occupiedBy = null; oldCh.isSitting = false; }
          p._chairIdx = undefined;
        }
        if (input.sitting && deskChairs[input.chairIdx]) {
          const ch = deskChairs[input.chairIdx];
          if (!ch.occupiedBy || ch.occupiedBy === id) {
            ch.occupiedBy = id; ch.isSitting = true; p._chairIdx = input.chairIdx;
            p.x = ch.x; p.z = ch.z + 1.2;
          }
          p.yaw = input.yaw; p.pitch = input.pitch;
          if (p.mesh) updateRemotePlayer(p);
          continue;
        }
      }
      // 黑猪模式：黑猪看着时移动=被罚，坐着也=被罚（服务端权威：用摇杆输入判定）
      if (gameMode === 'blackpig' && blackpig.isWatching && !blackpig.isTurning) {
        if (input.sitting) {
          hostDamagePlayer(id);
        } else if (Math.abs(input.dx) > 0.05 || Math.abs(input.dy) > 0.05) {
          hostDamagePlayer(id);
        }
        p.yaw = input.yaw; p.pitch = input.pitch;
        if (p.mesh) updateRemotePlayer(p);
        continue;
      }
      // SRT模式：被选为SRT的客户端，主机用摇杆输入积分SRT位置（服务端权威）
      if (gameMode === 'srt' && window._srtSelectedSrt === id) {
        if (!srt.alive) { p.yaw = input.yaw; p.pitch = input.pitch; if (p.mesh) updateRemotePlayer(p); continue; }
        const srtSpeed = (input.sprint ? 7.0 : 4.5) * (settings.pigSpeed || 1);
        const fwd = {x:-Math.sin(input.yaw), z:-Math.cos(input.yaw)};
        const right = {x:Math.cos(input.yaw), z:-Math.sin(input.yaw)};
        srt.x += (fwd.x*input.dy + right.x*input.dx)*srtSpeed*dt;
        srt.z += (fwd.z*input.dy + right.z*input.dx)*srtSpeed*dt;
        const shalf = SRT_FIELD_SIZE/2 - 2;
        srt.x = Math.max(-shalf, Math.min(shalf, srt.x));
        srt.z = Math.max(-shalf, Math.min(shalf, srt.z));
        if (srt.mesh) { srt.mesh.position.set(srt.x, 2, srt.z); srt.mesh.lookAt(player.x, 2, player.z); }
        if (srt.hasFrog && srtFrog.mesh) {
          srtFrog.mesh.position.set(srt.x, 0.8, srt.z+1);
          srtFrog.mesh.lookAt(player.x, 0.8, player.z);
        }
        if (!srt.hasFrog && !srtFrog.collected) {
          const fdx = srtFrog.x - srt.x, fdz = srtFrog.z - srt.z;
          if (Math.sqrt(fdx*fdx+fdz*fdz) < 2.0) {
            srt.hasFrog = true; srtFrog.collected = true; srt.escapeTimer = 0;
            if (srtFrog.mesh) srtFrog.mesh.visible = true;
            if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
            srtAudio.loop = true; srtAudio.volume = 0.8; srtAudio.play().catch(()=>{});
            Bridge.broadcast(JSON.stringify({type:'srtEvent', event:'frogTaken'}));
          }
        }
        p.x = srt.x; p.z = srt.z; p.yaw = input.yaw; p.pitch = input.pitch;
        if (p.mesh) p.mesh.visible = false;
        continue;
      }
      // 普通玩家：主机用摇杆输入积分位置（服务端权威）
      // 速度 = 基础速度 × 道具加速buff × 该玩家自己的开发者加速作弊
      let speed = input.sprint ? SPRINT_SPEED : PLAYER_SPEED;
      if (p.buffs.speedUntil > gameTime) speed *= 1.3;
      if (p.dev && p.dev.speed) speed *= (p.dev.speedMult || 2);
      const fwd = {x:-Math.sin(input.yaw), z:-Math.cos(input.yaw)};
      const right = {x:Math.cos(input.yaw), z:-Math.sin(input.yaw)};
      const mx = (fwd.x*input.dy + right.x*input.dx)*speed*dt;
      const mz = (fwd.z*input.dy + right.z*input.dx)*speed*dt;
      if (gameMode === 'pvp' || gameMode === 'blackpig') {
        p.x += mx; p.z += mz;
        const half = (gameMode === 'blackpig' && typeof blackpigFieldSize !== 'undefined') ? blackpigFieldSize/2 - 2 : 30;
        p.x = Math.max(-half, Math.min(half, p.x));
        p.z = Math.max(-half+8, Math.min(half, p.z));
      } else if (gameMode === 'srt') {
        p.x += mx; p.z += mz;
        const shalf = SRT_FIELD_SIZE/2 - 1;
        p.x = Math.max(-shalf, Math.min(shalf, p.x));
        p.z = Math.max(-shalf, Math.min(shalf, p.z));
      } else if (gameMode === 'survival') {
        // 打福瑞模式：空旷场地，只限边界（不能套用迷宫碰撞，否则客户端会被隐形墙挡住）
        p.x += mx; p.z += mz;
        const shalf = (typeof SURVIVAL !== 'undefined' ? SURVIVAL.FIELD_SIZE : 60)/2 - 2;
        p.x = Math.max(-shalf, Math.min(shalf, p.x));
        p.z = Math.max(-shalf, Math.min(shalf, p.z));
      } else if (gameMode === 'hide') {
        // 捉迷藏：新地图碰撞
        if (typeof moveWithHideCollision === 'function') moveWithHideCollision(p, mx, mz, PLAYER_RADIUS);
        else { p.x += mx; p.z += mz; }
        const hhalf = (typeof HIDE_FIELD !== 'undefined' ? HIDE_FIELD : 70)/2 - 2;
        p.x = Math.max(-hhalf, Math.min(hhalf, p.x));
        p.z = Math.max(-hhalf, Math.min(hhalf, p.z));
      } else {
        const nx = p.x+mx; if (!collides(nx,p.z,PLAYER_RADIUS) || settings.noclip) p.x = nx;
        const nz = p.z+mz; if (!collides(p.x,nz,PLAYER_RADIUS) || settings.noclip) p.z = nz;
      }
      p.yaw = input.yaw; p.pitch = input.pitch;
      // === 跳跃同步：主机为远程玩家模拟跳跃 ===
      if (p.jumpY === undefined) p.jumpY = 0;
      if (p.jumpVy === undefined) p.jumpVy = 0;
      if (p.onGround === undefined) p.onGround = true;
      // 收到跳跃指令时触发（上升沿：只在onGround=true时触发一次）
      if (input.jump && p.onGround) {
        p.jumpVy = JUMP_FORCE;
        p.onGround = false;
      }
      // 跳跃物理
      if (!p.onGround) {
        p.jumpVy += GRAVITY * dt;
        p.jumpY += p.jumpVy * dt;
        if (p.jumpY <= 0) {
          p.jumpY = 0;
          p.jumpVy = 0;
          p.onGround = true;
        }
      }
    }
    // SRT模式下SRT玩家的mesh隐藏
    if (gameMode === 'srt' && p.mesh) {
      p.mesh.visible = (window._srtSelectedSrt !== id) && !p.dead;
    }
    // 捉迷藏模式：隐藏远程玩家标签（主机视角）
    if (gameMode === 'hide' && p.mesh && p.mesh.userData && p.mesh.userData.label) {
      p.mesh.userData.label.visible = false;
    }
    if (!p.mesh && scene) { p.mesh = createPlayerMesh(p.color, p.name); if (p.mesh) { scene.add(p.mesh); if (gameMode === 'hide' && p.mesh.userData && p.mesh.userData.label) p.mesh.userData.label.visible = false; } }
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
  // 房主的nextbot追房主
  nextbot.targetId = 'host';
  // extraBots按顺序追对应玩家（第i只extraBot追第i+1个玩家）
  MP.extraBots.forEach((bot, i) => { bot.targetId = playerIds[(i+1) % playerIds.length]; });
  // 房主的nextbot重生
  if (!nextbot.alive) {
    if (nextbot.respawnTimer === undefined) nextbot.respawnTimer = 3;
    nextbot.respawnTimer -= dt;
    if (nextbot.respawnTimer <= 0) {
      nextbot.alive = true; nextbot.health = 100;
      const rp = (typeof findPigRespawnPoint === 'function') ? findPigRespawnPoint() : {x:14*CELL, z:1*CELL};
      nextbot.x = rp.x; nextbot.z = rp.z;
      nextbot.respawnTimer = undefined;
      nextbot.path = []; nextbot.pathTimer = 0;
      if (nextbot.mesh) resetEntityMesh(nextbot.mesh);
      if (nextbot.glowMesh) nextbot.glowMesh.visible = true;
      if (typeof updateHealthUI === 'function') updateHealthUI();
    }
  }
  for (const bot of MP.extraBots) {
    if (!bot.alive) {
      if (bot.respawnTimer === undefined) bot.respawnTimer = 3;
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) {
        bot.alive = true; bot.health = 100;
        const rp = (typeof findPigRespawnPoint === 'function') ? findPigRespawnPoint() : {x:14*CELL, z:1*CELL};
        bot.x = rp.x; bot.z = rp.z;
        bot.respawnTimer = undefined;
        bot.path = []; bot.pathTimer = 0;
        if (bot.mesh) resetEntityMesh(bot.mesh);
        if (bot.glowMesh) bot.glowMesh.visible = true;
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
      } else {
        // 寻路失败兜底：直接朝目标移动
        mx = tx; mz = tz;
      }
      const ndx = mx-bot.x, ndz = mz-bot.z, nd = Math.sqrt(ndx*ndx+ndz*ndz);
      if (nd > 0.1) {
        const mvx = (ndx/nd)*nextbotSpeed*dt;
        const mvz = (ndz/nd)*nextbotSpeed*dt;
        if (typeof moveWithCollision === 'function') moveWithCollision(bot, mvx, mvz, NEXTBOT_SIZE*0.35, false);
        else { bot.x += mvx; bot.z += mvz; }
      }
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

function hostProcessAttack(clientId, stage, dmgOverride, autoAim) {
  const attacker = MP.players[clientId]; if (!attacker) return;
  if (attacker.dead) return; // 死人不能攻击
  // 攻击强化道具buff（击杀者自己的）
  const buffDmg = (attacker.buffs && attacker.buffs.damageUntil > gameTime) ? 15 : 0;
  const dmg = dmgOverride > 0 ? dmgOverride : ((stage === 1 ? 15 : stage === 2 ? 20 : 30) + buffDmg);
  if (gameMode === 'pvp') {
    // PVP：攻击其他玩家
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    const targets = [{id:'host', x:player.x, z:player.z, obj:null, isHost:true}];
    for (const id in MP.players) {
      if (id === clientId) continue;
      const p = MP.players[id];
      if (p && !p.dead) targets.push({id, x:p.x, z:p.z, obj:p, isHost:false});
    }
    let hitSomething = false;
    for (const t of targets) {
      const dx = t.x - attacker.x, dz = t.z - attacker.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist > 3.5) continue;
      const toT = {x:dx/dist, z:dz/dist};
      if (!autoAim && fwd.x*toT.x + fwd.z*toT.z < 0.4) continue;
      hitSomething = true;
      if (t.isHost) {
        if (hostOnHostHit()) {
          Bridge.sendTo(clientId, JSON.stringify({type:'killConfirm', kills:1}));
        }
      } else if (t.obj && t.obj.invincible <= 0) {
        t.obj.health -= dmg; t.obj.invincible = 0.5;
        if (t.obj.health <= 0) {
          t.obj.health = 0; t.obj.dead = true; t.obj.alive = false;
          t.obj.respawnTimer = MP.RESPAWN_TIME;
          if (t.obj.mesh) setPlayerDead(t.obj.mesh, true);
          Bridge.sendTo(clientId, JSON.stringify({type:'killConfirm', kills:1}));
          Bridge.broadcast(JSON.stringify({type:'pvpKill', killer:clientId, victim:t.id, killerName:attacker.name, victimName:t.obj.name}));
        }
      }
    }
    if (hitSomething) Bridge.sendTo(clientId, JSON.stringify({type:'attackHit'}));
    return;
  }
  if (gameMode === 'srt') {
    // SRT：攻击SRT实体
    if (!srt.alive || !srt.hasFrog) return;
    const dx = srt.x - attacker.x, dz = srt.z - attacker.z;
    const dist = Math.sqrt(dx*dx+dz*dz);
    if (dist > 5) return;
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    const toS = {x:dx/dist, z:dz/dist};
    if (!autoAim && fwd.x*toS.x + fwd.z*toS.z < 0.3) return;
    srtTakeDamage(dmg);
    Bridge.broadcast(JSON.stringify({type:'srtHit', damage:dmg, health:srt.health}));
    return;
  }
  if (gameMode === 'survival') {
    // 生存模式：客户端攻击由主机代为判定（伤害含该玩家的强化buff，积分记入该玩家）
    const baseDmg = stage === 1 ? 15 : stage === 2 ? 20 : 30;
    const finalDmg = dmgOverride > 0 ? dmgOverride : (baseDmg + buffDmg);
    let hitAny = false;
    for (const pig of survival.pigs) {
      if (!pig.alive) continue;
      const dx = pig.x - attacker.x, dz = pig.z - attacker.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist > 5.5) continue;
      const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
      const toPig = {x:dx/dist, z:dz/dist};
      if (!autoAim && fwd.x*toPig.x + fwd.z*toPig.z < 0.15) continue;
      pig.health -= finalDmg;
      hitAny = true;
      if (pig.hpSprite && typeof drawSurvivalPigHP === 'function') drawSurvivalPigHP(pig.hpSprite, pig.health);
      if (pig.health <= 0) survivalPigKilled(pig, clientId);
    }
    if (hitAny) Bridge.sendTo(clientId, JSON.stringify({type:'attackHit'}));
    return;
  }
  if (gameMode === 'hide') {
    // 捉迷藏：只有抓捕者能攻击，一刀致命
    if (clientId !== hide.seeker) return;
    if (hide.phase !== 'seek') return;
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    for (const id in MP.players) {
      if (id === hide.seeker) continue;
      const p = MP.players[id];
      if (p.dead) continue;
      const dx = p.x - attacker.x, dz = p.z - attacker.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist > HIDE_KILL_RANGE) continue;
      const toP = {x:dx/dist, z:dz/dist};
      if (!autoAim && fwd.x*toP.x + fwd.z*toP.z < 0.3) continue;
      if (typeof spawnKillBurst === 'function') spawnKillBurst(p.x, 1.4, p.z);
      if (p.mesh && typeof animateDeath === 'function') animateDeath(p.mesh);
      hostDamagePlayer(id, true);
      Bridge.sendTo(clientId, JSON.stringify({type:'killConfirm', kills:1}));
    }
    // 房主是躲藏者的情况
    if (hide.seeker !== 'host' && !MP._hostDead) {
      const dx = player.x - attacker.x, dz = player.z - attacker.z;
      const dist = Math.sqrt(dx*dx+dz*dz);
      if (dist <= HIDE_KILL_RANGE) {
        const toP = {x:dx/dist, z:dz/dist};
        if (autoAim || fwd.x*toP.x + fwd.z*toP.z >= 0.3) {
          if (typeof spawnKillBurst === 'function') spawnKillBurst(player.x, 1.4, player.z);
          MP._hostHealth = 0; MP._hostDead = true; MP._hostRespawnTimer = MP.RESPAWN_TIME;
          playerHealth = 0; if (typeof updateHealthUI === 'function') updateHealthUI();
          if (typeof showHostDeath === 'function') showHostDeath();
          Bridge.sendTo(clientId, JSON.stringify({type:'killConfirm', kills:1}));
        }
      }
    }
    return;
  }
  if (gameMode !== 'hunt') return;
  const allBots = [nextbot, ...MP.extraBots];
  let hitAny = false;
  for (const bot of allBots) {
    if (!bot.alive) continue;
    const dx = bot.x - attacker.x, dz = bot.z - attacker.z;
    const dist = Math.sqrt(dx*dx+dz*dz);
    if (dist > 5.5) continue; // 放宽距离补偿网络延迟
    const fwd = {x:-Math.sin(attacker.yaw), z:-Math.cos(attacker.yaw)};
    const toBot = {x:dx/dist, z:dz/dist};
    if (!autoAim && fwd.x*toBot.x + fwd.z*toBot.z < 0.15) continue; // 放宽角度
    bot.health -= dmg;
    hitAny = true;
    if (bot.health <= 0) {
      bot.alive = false; bot.respawnTimer = 3;
      if (bot.mesh) bot.mesh.visible = false;
      if (bot.glowMesh) bot.glowMesh.visible = false;
    }
  }
  if (hitAny) Bridge.sendTo(clientId, JSON.stringify({type:'attackHit'}));
}
function hostDamagePlayer(clientId, instantKill) {
  const p = MP.players[clientId];
  if (!p || p.dead || p.invincible > 0) return;
  // 该客户端开了开发者无敌作弊：免疫
  if (p.dev && p.dev.invincible) return;
  // 死亡/掉血前释放椅子
  if (p._chairIdx !== undefined && typeof deskChairs !== 'undefined' && deskChairs[p._chairIdx]) {
    const ch = deskChairs[p._chairIdx];
    if (ch.occupiedBy === clientId) { ch.occupiedBy = null; ch.isSitting = false; }
    p._chairIdx = undefined;
  }
  if (gameMode === 'normal' || gameMode === 'blackpig' || instantKill) {
    // 普通/黑猪/猪碰人：一击必杀
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
    // 捉迷藏：房主（躲藏者）出局不复活
    if (gameMode === 'hide') return;
    MP._hostRespawnTimer -= dt;
    if (MP._hostRespawnTimer <= 0) {
      const sp = findSafeSpawn(); player.x=sp.x; player.z=sp.z;
      MP._hostHealth=MP.MAX_HEALTH; MP._hostDead=false; MP._hostInvincible=MP.INVINCIBLE_TIME;
      playerHealth = MP.MAX_HEALTH; if (typeof updateHealthUI === 'function') updateHealthUI();
      hideHostDeath();
      // 复活后重置所有猪的路径，让猪直接重新追
      if (gameMode === 'normal' || gameMode === 'hunt') {
        nextbot.path = []; nextbot.pathTimer = 0;
        for (const bot of MP.extraBots) { bot.path = []; bot.pathTimer = 0; }
        if (typeof nextbotAudio !== 'undefined' && nextbotAudio) { try { nextbotAudio.currentTime = 0; nextbotAudio.play().catch(()=>{}); } catch(e){} }
      }
      // 打福瑞模式：复活后重新分配猪的目标
      if (gameMode === 'survival' && typeof assignPigTargets === 'function') {
        assignPigTargets();
      }
      // 复活时清理椅子占用
      if (typeof deskChairs !== 'undefined') {
        for (const c of deskChairs) { if (c.occupiedBy === 'self') { c.occupiedBy = null; c.isSitting = false; } }
      }
      if (typeof standUpCooldown !== 'undefined') standUpCooldown = 1.0;
    }
    return;
  }
  if (MP._hostInvincible > 0) MP._hostInvincible -= dt;
}
function hostOnHostHit() {
  // 开发者无敌模式：房主免疫伤害/即死
  if (typeof devInvincible === 'function' && devInvincible()) return false;
  if (MP._hostDead || MP._hostInvincible > 0) return false;
  if (gameMode === 'normal' || gameMode === 'blackpig') {
    // 普通/黑猪模式：一击必杀
    MP._hostHealth = 0; MP._hostDead = true; MP._hostRespawnTimer = MP.RESPAWN_TIME;
    playerHealth = 0; if (typeof updateHealthUI === 'function') updateHealthUI();
    // 显示死亡视觉反馈
    if (typeof showHostDeath === 'function') showHostDeath();
  } else {
    // 打猪/PVP：扣血
    MP._hostHealth -= 15; MP._hostInvincible = 0.8; playerHealth = MP._hostHealth;
    if (typeof updateHealthUI === 'function') updateHealthUI();
    // 受伤闪红
    const flash = document.getElementById('hitFlash');
    if (flash) { flash.style.background = 'rgba(255,0,0,0.3)'; flash.style.opacity = '1'; setTimeout(() => { flash.style.opacity = '0'; flash.style.background = 'rgba(255,255,255,0.3)'; }, 100); }
    if (MP._hostHealth <= 0) {
      MP._hostHealth = 0; MP._hostDead = true; MP._hostRespawnTimer = MP.RESPAWN_TIME;
      playerHealth = 0; if (typeof updateHealthUI === 'function') updateHealthUI();
      if (typeof showHostDeath === 'function') showHostDeath();
    }
  }
  return true;
}

function clientConnect(ip, port) {
  MP.mode = 'client';
  MP._lastConnectedIp = ip;
  MP._lastConnectedPort = port || MP.roomPort;
  MP._reconnectAttempts = 0;
  if (MP._reconnectTimer) { clearTimeout(MP._reconnectTimer); MP._reconnectTimer = null; }
  Bridge.connect(ip, MP._lastConnectedPort);
}
function clientDisconnect() {
  // 主动退出：清掉重连状态，防止onDisconnected误触发自动重连
  MP._lastConnectedIp = null;
  MP._lastConnectedPort = null;
  MP._reconnectAttempts = 0;
  if (MP._reconnectTimer) { clearTimeout(MP._reconnectTimer); MP._reconnectTimer = null; }
  try { Bridge.send(JSON.stringify({type:'leave'})); } catch(e) {}
  Bridge.disconnect(); MP.connected = false; MP.mode = 'offline'; cleanupMultiplayer();
}
function handleClientMessage(msg) {
  // 带宽统计：记录接收字节
  MP.bytesRecv += (JSON.stringify(msg).length);
  switch(msg.type) {
    case 'pong': {
      // 主机回传的ping响应：计算RTT
      if (msg.ts && MP._pingSent) {
        MP.ping = Date.now() - MP._pingSent;
        MP._pingSent = 0;
      }
      return;
    }
    case 'welcome': {
      MP.myId = msg.id; MP.myColor = msg.color; MP.selectedMode = msg.mode;
      // === 握手验证：保存token ===
      if (msg.token) MP._handshakeToken = msg.token;
      // === 重连成功：重置重连计数 ===
      MP._reconnectAttempts = 0;
      if (msg.srtPlayerId) window._srtSelectedSrt = msg.srtPlayerId;
      if (msg.hideSeekerId) hide.seeker = msg.hideSeekerId;
      if (msg.settings) applyRemoteSettings(msg.settings);
      if (MP.onJoined) MP.onJoined(msg);
      // welcome里带了游戏状态，直接进游戏，不等startGame消息
      if (msg.gameRunning && msg.mode) {
        MP.gameStarted = true;
        if (typeof clientSendDevCheat === 'function') clientSendDevCheat();
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
      // 捉迷藏：客户端从startGame消息获取seekerId（hideAssign可能在startGame之前到达但gameMode还未设置）
      if (msg.mode === 'hide' && msg.seeker) {
        hide.seeker = msg.seeker;
      }
      if (typeof clientSendDevCheat === 'function') clientSendDevCheat(); // 上报作弊状态
      if (MP.onGameStart) MP.onGameStart(msg.mode);
      break;
    }
    case 'srtAssign': {
      window._srtSelectedSrt = msg.srtPlayerId;
      if (typeof srtIsPlayerSRT !== 'undefined') srtIsPlayerSRT = (msg.srtPlayerId === MP.myId);      // 如果已在SRT游戏中，立即更新UI
      if (gameMode === 'srt' && gameRunning) {
        const showAtk = !srtIsPlayerSRT;
        const atkBtn = document.getElementById('attackBtn');
        const hotbar = document.getElementById('hotbar');
        if (atkBtn) atkBtn.style.display = showAtk ? 'flex' : 'none';
        if (hotbar) hotbar.style.display = showAtk ? 'flex' : 'none';
        if (swordGroup) swordGroup.visible = showAtk;
        if (srt.mesh) srt.mesh.visible = !srtIsPlayerSRT;
        if (typeof showSRTStatus === 'function') showSRTStatus(srtIsPlayerSRT ? '你是SRT！逃跑！' : '追杀SRT！');
      }
      break;
    }
    case 'gameOver': { if (gameRunning) gameOver('caught'); break; }
    case 'srtEvent': {
      if (msg.event === 'frogTaken') {
        srt.hasFrog = true; srtFrog.collected = true;
        if (srtFrog.mesh) srtFrog.mesh.visible = true;
        if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
        srtAudio.loop = true; srtAudio.volume = 0.8; srtAudio.play().catch(()=>{});
        if (srtIsPlayerSRT) {
          // SRT玩家自己：显示OK按钮，等待点击后才开始逃跑
          srt.state = 'seekingFrog';
          if (typeof showSRTStatus === 'function') showSRTStatus('你拿到青蛙了！点OK开始');
          const okBtn = document.getElementById('srtOKBtn');
          if (okBtn) okBtn.style.display = 'block';
        } else {
          // 其他玩家：提示SRT已拿到青蛙，逃跑开始时机由主机state同步
          if (typeof showSRTStatus === 'function') showSRTStatus('SRT拿到青蛙了！追杀它！');
          const okBtn = document.getElementById('srtOKBtn');
          if (okBtn) okBtn.style.display = 'none';
        }
      } else if (msg.event === 'win') {
        if (typeof srtGameOver === 'function') srtGameOver(true);
      } else if (msg.event === 'lose') {
        if (typeof srtGameOver === 'function') srtGameOver(false);
      }
      break;
    }
    case 'srtHit': {
      srt.health = msg.health;
      if (typeof updateSRTHealthBar === 'function') updateSRTHealthBar();
      const flash = document.getElementById('hitFlash');
      if (flash) { flash.style.opacity = '1'; setTimeout(()=>flash.style.opacity='0', 80); }
      break;
    }
    case 'pvpKill': {
      if (typeof showToast === 'function') showToast((msg.killerName||'')+' 击杀了 '+(msg.victimName||''), 1500);
      break;
    }
    case 'killConfirm': {
      window.pvpKills = (window.pvpKills || 0) + (msg.kills || 1);
      // 我的信息：击杀数（PVP与捉迷藏抓捕）
      if (typeof recordKill === 'function') recordKill(gameMode === 'hide' ? 'hide' : 'pvp');
      break;
    }
    case 'hideAssign': {
      hide.seeker = msg.seekerId || 'host';
      // 收到抓捕者分配后，立即更新剑和UI
      if (gameMode === 'hide' && gameRunning) {
        const myId = MP.myId || 'host';
        const iAmSeeker = (hide.seeker === myId);
        window._hideIAmSeeker = iAmSeeker;
        swordEquipped = iAmSeeker;
        if (swordGroup) swordGroup.visible = iAmSeeker;
        const showSword = iAmSeeker;
        document.getElementById('attackBtn').style.display = showSword ? 'flex' : 'none';
        document.getElementById('hotbar').style.display = showSword ? 'flex' : 'none';
        document.getElementById('healthBarContainer').style.display = showSword ? 'block' : 'none';
      }
      break;
    }
    case 'hideEvent': {
      if (typeof showHideGameOver === 'function') {
        showHideGameOver(msg.event === 'seekerWin' ? 'seeker' : 'hider');
      }
      break;
    }
    case 'attackHit': {
      const flash = document.getElementById('hitFlash');
      if (flash) { flash.style.opacity = '1'; setTimeout(()=>flash.style.opacity='0', 80); }
      break;
    }
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
  $('hud').textContent = formatTime(gameTime);
  if (state.bots && state.bots.length > 0) {
    const mainBot = state.bots[0];
    nextbot.targetX = mainBot.x; nextbot.targetZ = mainBot.z; nextbot.alive = mainBot.alive; nextbot.health = mainBot.health;
    nextbot.targetId = mainBot.targetId || 'host';
    if (nextbot.mesh) {
      nextbot.mesh.visible = nextbot.alive;
      // 猪的位置在animate中插值更新
      nextbot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    }
    if (nextbot.glowMesh) { nextbot.glowMesh.visible = nextbot.alive; if (nextbot.mesh) nextbot.glowMesh.position.copy(nextbot.mesh.position); }
    if (typeof updateHealthUI === 'function') updateHealthUI();
    if (gameMode === 'hunt' || gameMode === 'normal') {
      while (MP.extraBots.length < state.bots.length - 1) {
        const idx = MP.extraBots.length + 1;
        const bot = createExtraBot(idx % MP.PLAYER_COLORS.length);
        if (bot) MP.extraBots.push(bot); else break;
      }
      for (let i = 1; i < state.bots.length; i++) {
        const bot = MP.extraBots[i-1]; if (!bot) continue;
        const bd = state.bots[i];
        bot.alive = bd.alive; bot.health = bd.health;
        bot.targetId = bd.targetId;
        bot.mesh.visible = bot.alive; bot.glowMesh.visible = bot.alive;
        if (bot.alive) {
          // 插值而非瞬移
          if (bot.targetX === undefined) { bot.x = bd.x; bot.z = bd.z; }
          bot.targetX = bd.x; bot.targetZ = bd.z;
        }
      }
    }
  }
  const seenIds = new Set();
  for (const pdata of (state.players || [])) {
    seenIds.add(pdata.id);
    if (pdata.id === MP.myId) {
      // 服务端权威：位置由主机下发，客户端做插值平滑（不做本地预测）
      playerHealth = pdata.health; if (typeof updateHealthUI === 'function') updateHealthUI();
      // Ping计算：主机回传了客户端的echoTs，据此算RTT
      if (pdata.echoTs && MP._lastInputTime && pdata.echoTs === MP._lastInputTime) {
        MP.ping = Date.now() - pdata.echoTs;
      }
      // 打福瑞模式：自己的独立积分（主机权威，客户端镜像用于商店）
      if (gameMode === 'survival' && pdata.points !== undefined && typeof survival !== 'undefined') {
        survival.points = pdata.points;
      }
      if (!pdata.dead) {
        if (gameMode === 'srt' && typeof srtIsPlayerSRT !== 'undefined' && srtIsPlayerSRT) {
          if (typeof srt !== 'undefined') {
            if (srt.targetX === undefined) { srt.x = pdata.x; srt.z = pdata.z; }
            srt.targetX = pdata.x; srt.targetZ = pdata.z;
          }
        } else {
          if (player.tx === undefined) { player.x = pdata.x; player.z = pdata.z; }
          player.tx = pdata.x; player.tz = pdata.z;
          // === 跳跃同步：客户端接受主机的jumpY ===
          player.tJumpY = (pdata.jumpY !== undefined) ? pdata.jumpY : 0;
          // 落地状态：由主机权威同步（jumpY≈0表示在地面）
          if (pdata.jumpY !== undefined && pdata.jumpY <= 0.01) {
            if (!player.onGround) player.onGround = true;
          } else {
            player.onGround = false;
          }
        }
      }
      if (pdata.dead && !MP._clientDead) { MP._clientDead = true; showDeathOverlay(); }
      else if (!pdata.dead && MP._clientDead) {
        MP._clientDead = false; hideDeathOverlay();
        // 复活时传送到主机指定的复活点（直接落位，取消平滑目标）
        if (gameMode === 'srt' && typeof srtIsPlayerSRT !== 'undefined' && srtIsPlayerSRT) {
          if (typeof srt !== 'undefined') { srt.x = pdata.x; srt.z = pdata.z; srt.targetX = undefined; srt.targetZ = undefined; }
        } else {
          player.x = pdata.x; player.z = pdata.z;
          player.tx = undefined; player.tz = undefined; player.tJumpY = 0;
        }
        player.jumpVel = 0; player.onGround = true; player.jumpY = 0;
        // 复活时清理椅子占用
        if (typeof deskChairs !== 'undefined') {
          for (const c of deskChairs) { if (c.occupiedBy === 'self') { c.occupiedBy = null; c.isSitting = false; } }
        }
        if (typeof standUpCooldown !== 'undefined') standUpCooldown = 1.0;
      }
      continue;
    }
    let rp = MP.remotePlayers[pdata.id];
    if (!rp) {
      rp = {id:pdata.id, name:pdata.name, color:pdata.color, mesh:createPlayerMesh(pdata.color, pdata.name),
        x:pdata.x, z:pdata.z, jumpY:pdata.jumpY||0, yaw:pdata.yaw, health:pdata.health, dead:pdata.dead,
        targetX:pdata.x, targetZ:pdata.z, targetJumpY:pdata.jumpY||0, targetYaw:pdata.yaw};
      if (rp.mesh) {
        scene.add(rp.mesh);
        // 捉迷藏模式：创建时立即隐藏名字标签（防止暴露位置）
        if (gameMode === 'hide' && rp.mesh.userData && rp.mesh.userData.label) {
          rp.mesh.userData.label.visible = false;
        }
      }
      MP.remotePlayers[pdata.id] = rp;
    }
    rp.targetX = pdata.x; rp.targetZ = pdata.z; rp.targetJumpY = pdata.jumpY||0; rp.targetYaw = pdata.yaw;
    rp.name = pdata.name; rp.health = pdata.health; rp.dead = pdata.dead;
    if (rp.mesh) {
      setPlayerDead(rp.mesh, pdata.dead);
      // SRT模式下，扮演SRT的玩家其mesh隐藏（SRT实体已代表该玩家）
      if (gameMode === 'srt' && state.srt && state.srt.srtPlayerId === pdata.id) {
        rp.mesh.visible = false;
      }
      // 捉迷藏模式：严格控制mesh和名字标签可见性，防止暴露位置
      else if (gameMode === 'hide' && typeof hide !== 'undefined') {
        const iAmSeeker = window._hideIAmSeeker;
        const isSeeker = (pdata.id === hide.seeker);
        if (hide.phase === 'hide') {
          // 躲藏期：完全隐藏其他玩家（抓捕者蒙眼期间）
          rp.mesh.visible = false;
        } else if (hide.phase === 'seek') {
          // 搜捕期：显示人物但隐藏名字血条标签
          rp.mesh.visible = !pdata.dead;
          if (rp.mesh.userData.label) rp.mesh.userData.label.visible = false;
          // 抓捕者看不到躲藏者的名字，躲藏者看不到抓捕者的名字
        }
      } else {
        if (rp.mesh.userData.label) rp.mesh.userData.label.visible = true;
        updatePlayerLabel(rp.mesh.userData.label, pdata.name, MP.PLAYER_COLORS[pdata.color], pdata.health);
      }
    }
  }
  for (const id in MP.remotePlayers) {
    if (!seenIds.has(id)) { if (MP.remotePlayers[id].mesh) scene.remove(MP.remotePlayers[id].mesh); delete MP.remotePlayers[id]; }
  }
  // 黑猪模式：同步黑猪位置和朝向
  if (gameMode === 'blackpig' && state.blackpig && typeof blackpig !== 'undefined') {
    blackpig.x = state.blackpig.x; blackpig.z = state.blackpig.z;
    const wasWatching = blackpig.isWatching;
    const wasTurning = blackpig.isTurning;
    blackpig.isWatching = state.blackpig.isWatching;
    blackpig.isTurning = state.blackpig.isTurning;
    if (blackpig.mesh) {
      blackpig.mesh.position.set(blackpig.x, 6, blackpig.z);
    }
    // 换面开始（isTurning false→true）：立即播放换面音效，与主机同步
    if (!wasTurning && blackpig.isTurning) {
      if (typeof bpStopAll === 'function' && typeof sfxBpTurn !== 'undefined' && sfxBpTurn) {
        bpStopAll();
        if (typeof bpAudioQueue !== 'undefined' && typeof bpPlayQueue === 'function') {
          bpAudioQueue.push({audio:sfxBpTurn, duration:1.5, callback:()=>{
            // 换面音效结束后由 isWatching 变化触发音乐播放（等待主机同步最新朝向）
          }});
          bpPlayQueue();
        }
      }
    }
    // 朝向变化（换面结束）：播放对应音乐，与主机同步
    if (blackpig.isWatching !== wasWatching && !blackpig.isTurning) {
      if (typeof bpStopAll === 'function') bpStopAll();
      if (blackpig.isWatching && typeof sfxBpBack !== 'undefined' && sfxBpBack) {
        if (typeof bpAudioQueue !== 'undefined' && typeof bpPlayQueue === 'function') {
          bpAudioQueue.push({audio:sfxBpBack, duration:8}); bpPlayQueue();
        }
      } else if (!blackpig.isWatching && typeof sfxBpFront !== 'undefined' && sfxBpFront) {
        if (typeof bpAudioQueue !== 'undefined' && typeof bpPlayQueue === 'function') {
          bpAudioQueue.push({audio:sfxBpFront, duration:8}); bpPlayQueue();
        }
      }
    }
    // 朝向变化：更新材质（音乐由上面换面音效结束后播放，避免重复）
    if (blackpig.mesh && blackpig.isWatching !== wasWatching) {
      if (blackpig.isWatching) {
        if (blackpig.frontTex) blackpig.mesh.material.map = blackpig.frontTex;
        blackpig.mesh.material.color.setHex(0xff4444);
      } else {
        if (blackpig.backTex) blackpig.mesh.material.map = blackpig.backTex;
        blackpig.mesh.material.color.setHex(0x4444ff);
      }
      blackpig.mesh.material.needsUpdate = true;
    }
    if (typeof updateBlackpigStatusUI === 'function') updateBlackpigStatusUI();
  }
  // SRT模式：同步SRT实体和青蛙
  if (gameMode === 'srt' && state.srt && typeof srt !== 'undefined') {
    const ss = state.srt;
    const iAmSrt = (ss.srtPlayerId === MP.myId);
    window._srtSelectedSrt = ss.srtPlayerId;
    srtIsPlayerSRT = iAmSrt;
    // 青蛙位置同步
    if (srtFrog) {
      srtFrog.x = ss.frogX; srtFrog.z = ss.frogZ; srtFrog.collected = ss.frogCollected;
      if (srtFrog.mesh) {
        srtFrog.mesh.visible = ss.frogVisible;
        if (!ss.frogCollected) {
          srtFrog.mesh.position.set(ss.frogX, 0.8, ss.frogZ);
          srtFrog.mesh.lookAt(camera.position.x, 0.8, camera.position.z);
        }
      }
    }
    srt.alive = ss.alive; srt.hasFrog = ss.hasFrog; srt.state = ss.state;
    srt.health = ss.health; srt.escapeTimer = ss.escapeTimer || 0;
    if (srt.mesh) {
      srt.mesh.visible = ss.alive;
      if (iAmSrt) {
        // 自己是SRT：本地预测，位置由本地控制，不被state覆盖
        srt.mesh.visible = false; // 第一人称看不到自己的SRT模型
      } else {
        // 其他玩家：插值到主机位置
        if (srt.targetX === undefined) { srt.x = ss.x; srt.z = ss.z; }
        srt.targetX = ss.x; srt.targetZ = ss.z;
      }
    }
    if (typeof updateSRTHealthBar === 'function') updateSRTHealthBar();
    if (typeof showSRTStatus === 'function') {
      if (!ss.alive) showSRTStatus('SRT被击败！');
      else if (ss.hasFrog && srt.state === 'running') showSRTStatus('SRT拿到青蛙了！追杀它！');
    }
  }
  // 黑猪模式：同步其他玩家占用的椅子
  if (gameMode === 'blackpig' && typeof deskChairs !== 'undefined' && state.players) {
    for (const c of deskChairs) { if (c.occupiedBy !== 'self') { c.occupiedBy = null; c.isSitting = false; } }
    for (const pdata of state.players) {
      if (pdata.chairIdx !== undefined && pdata.chairIdx >= 0 && pdata.id !== MP.myId && deskChairs[pdata.chairIdx]) {
        deskChairs[pdata.chairIdx].occupiedBy = pdata.id;
        deskChairs[pdata.chairIdx].isSitting = true;
      }
    }
  }
  // 生存模式：同步猪与波次信息（客户端只渲染，不做权威逻辑）
  if (gameMode === 'survival' && state.survival && typeof survival !== 'undefined') {
    const ss = state.survival;
    survival.wave = ss.wave; survival.points = ss.points; survival.totalKills = ss.totalKills;
    survival.waveActive = ss.waveActive; survival.wavePigsRemaining = ss.wavePigsRemaining;
    survival.waveDelay = ss.waveDelay;
    // 猪数量对齐（复用共享视觉资源，与主机同一套纹理/几何体）
    while (survival.pigs.length < ss.pigs.length && typeof createSurvivalPigVisual === 'function') {
      const visual = createSurvivalPigVisual();
      const pig = { x:0, z:0, mesh:visual.mesh, glowMesh:visual.glowMesh, hpSprite:visual.hpSprite,
        health:100, alive:true, respawnTimer:0, counted:false, speed:0, path:[], pathTimer:0,
        targetX:undefined, targetZ:undefined };
      scene.add(pig.mesh); scene.add(pig.glowMesh);
      pig.mesh.position.set(0, NEXTBOT_SIZE/2+0.15, 0);
      pig.glowMesh.position.copy(pig.mesh.position);
      survival.pigs.push(pig);
    }
    while (survival.pigs.length > ss.pigs.length) {
      const pig = survival.pigs.pop();
      if (pig.mesh) scene.remove(pig.mesh);
      if (pig.glowMesh) scene.remove(pig.glowMesh);
    }
    for (let i = 0; i < ss.pigs.length && i < survival.pigs.length; i++) {
      const pig = survival.pigs[i]; const pd = ss.pigs[i];
      pig.alive = pd.alive; pig.health = pd.health;
      if (pig.hpSprite && typeof drawSurvivalPigHP === 'function') drawSurvivalPigHP(pig.hpSprite, pd.health);
      if (pig.targetX === undefined) { pig.x = pd.x; pig.z = pd.z; }
      pig.targetX = pd.x; pig.targetZ = pd.z;
      if (pig.mesh) pig.mesh.visible = pig.alive;
      if (pig.glowMesh) pig.glowMesh.visible = pig.alive;
    }
  }
  // 捉迷藏模式：同步阶段/计时/抓捕者
  if (gameMode === 'hide' && state.hide) {
    hide.phase = state.hide.phase;
    hide.timer = state.hide.timer;
    if (state.hide.seekerId) hide.seeker = state.hide.seekerId;
    // 防御性：每帧同步剑和UI可见性（防止startGame时序问题导致剑丢失）
    if (gameRunning) {
      const myId = MP.myId || 'host';
      const iAmSeeker = (hide.seeker === myId);
      window._hideIAmSeeker = iAmSeeker;
      if (swordEquipped !== iAmSeeker) swordEquipped = iAmSeeker;
      if (swordGroup && swordGroup.visible !== iAmSeeker) {
        swordGroup.visible = iAmSeeker;
        swordGroup.renderOrder = 999;
      }
      // 同步挥刀按钮/物品栏/血条显隐，确保客户端当抓捕者时两端都能显示
      const atkBtn = document.getElementById('attackBtn');
      if (atkBtn) {
        const want = iAmSeeker ? 'flex' : 'none';
        if (atkBtn.style.display !== want) atkBtn.style.display = want;
      }
      const hb = document.getElementById('hotbar');
      if (hb) { const want = iAmSeeker ? 'flex' : 'none'; if (hb.style.display !== want) hb.style.display = want; }
      const hc = document.getElementById('healthBarContainer');
      if (hc) { const want = iAmSeeker ? 'block' : 'none'; if (hc.style.display !== want) hc.style.display = want; }
    }
  }
  // 客户端击杀特效：对比上次状态，检测死亡瞬间播放粒子
  if (typeof clientDetectDeaths === 'function') clientDetectDeaths(state);
  // 捉迷藏模式：强制隐藏所有远程玩家的label（终极保障，任何代码重新显示都会被这里覆盖）
  if (gameMode === 'hide' && typeof hide !== 'undefined' && hide.phase !== 'idle') {
    for (const pid in MP.remotePlayers) {
      const rp = MP.remotePlayers[pid];
      if (rp && rp.mesh && rp.mesh.userData && rp.mesh.userData.label) {
        rp.mesh.userData.label.visible = false;
      }
    }
  }
  if (state.gameOver && gameRunning) gameOver('caught');
}

// 客户端死亡特效检测：状态快照对比
function clientDetectDeaths(state) {
  try {
    const prev = MP._prevAlive || {};
    (state.bots || []).forEach((b, i) => {
      const key = 'bot' + i;
      if (prev[key] === true && !b.alive && typeof spawnKillBurst === 'function') spawnKillBurst(b.x, 1.4, b.z);
      prev[key] = !!b.alive;
    });
    if (state.survival) (state.survival.pigs || []).forEach((p, i) => {
      const key = 'pig' + i;
      if (prev[key] === true && !p.alive && typeof spawnKillBurst === 'function') spawnKillBurst(p.x, 1.4, p.z);
      prev[key] = !!p.alive;
    });
    (state.players || []).forEach(pl => {
      const key = 'pl' + pl.id;
      if (prev[key] === true && pl.dead && typeof spawnKillBurst === 'function') spawnKillBurst(pl.x, 1.4, pl.z, 0x66aaff);
      prev[key] = !pl.dead;
    });
    MP._prevAlive = prev;
  } catch (e) {}
}
function clientUpdateRemotePlayers(dt) {
  const lerpSpeed = 15; // 提高插值速度，减少客户端卡顿感
  for (const id in MP.remotePlayers) {
    const rp = MP.remotePlayers[id];
    rp.x += (rp.targetX - rp.x) * Math.min(1, dt*lerpSpeed);
    rp.z += (rp.targetZ - rp.z) * Math.min(1, dt*lerpSpeed);
    // 跳跃Y值插值
    rp.jumpY = rp.jumpY || 0;
    rp.targetJumpY = rp.targetJumpY || 0;
    rp.jumpY += (rp.targetJumpY - rp.jumpY) * Math.min(1, dt*lerpSpeed);
    // yaw插值，处理角度环绕
    let dyaw = rp.targetYaw - rp.yaw;
    while (dyaw > Math.PI) dyaw -= 2*Math.PI;
    while (dyaw < -Math.PI) dyaw += 2*Math.PI;
    rp.yaw += dyaw * Math.min(1, dt*lerpSpeed);
    if (rp.mesh) {
      rp.mesh.position.set(rp.x, rp.jumpY || 0, rp.z);
      if (!rp.dead) rp.mesh.rotation.y = rp.yaw;
      if (rp.mesh.userData.label) {
        rp.mesh.userData.label.lookAt(camera.position);
        // 捉迷藏模式：强制每帧隐藏所有label，防止被其他代码重新显示
        if (gameMode === 'hide' && typeof hide !== 'undefined' && hide.phase !== 'idle') {
          rp.mesh.userData.label.visible = false;
        }
      }
    }
  }
}
// 客户端：生存模式猪的位置插值（与远程玩家同一套平滑策略）
function clientUpdateSurvivalPigs(dt) {
  for (const pig of survival.pigs) {
    if (pig.targetX === undefined) continue;
    const lf = Math.min(1, dt*15);
    pig.x += (pig.targetX - pig.x) * lf;
    pig.z += (pig.targetZ - pig.z) * lf;
    if (pig.mesh && pig.alive) {
      pig.mesh.position.set(pig.x, NEXTBOT_SIZE/2+0.15, pig.z);
      pig.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
      if (pig.glowMesh) {
        pig.glowMesh.position.copy(pig.mesh.position);
        pig.glowMesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
      }
    }
  }
}
function clientSendInput() {
  if (MP.mode !== 'client' || !MP.connected || !MP.gameStarted) return;
  const now = Date.now();
  // 黑猪模式：同步坐下状态和椅子索引
  let sitting = false, chairIdx = -1;
  if (gameMode === 'blackpig' && typeof deskChairs !== 'undefined') {
    const idx = deskChairs.findIndex(c => c.occupiedBy === 'self');
    if (idx >= 0) { sitting = true; chairIdx = idx; }
  }
  // 带宽优化：输入签名（量化到两位小数）——无变化时仅每200ms心跳，变化时限频20ms
  // 跳跃修复：签名必须包含Space键状态。否则doJump把onGround设false导致的签名变化，
  //   会被主机"jumpY=0→onGround复位"的广播抢先抵消，限频内又来不及发，跳跃请求就被吞掉
  //   （表现为躲猫猫等模式下客户端偶尔跳不起来）。
  const sig = joystick.dx.toFixed(2) + ',' + joystick.dy.toFixed(2) + ',' +
    player.yaw.toFixed(2) + ',' + player.pitch.toFixed(2) + ',' +
    (sprintActive ? 1 : 0) + ',' + (player.onGround ? 0 : 1) + ',' +
    (sitting ? 1 : 0) + ',' + chairIdx + ',' +
    (typeof KEYS !== 'undefined' && KEYS['Space'] ? 1 : 0);
  // 跳跃是离散关键输入：空格状态一旦变化必须立即上报（跳过20ms限频），
  // 否则快速点按会被限频吞掉（表现为躲猫猫等模式下客户端跳不起来）
  const spaceHeldNow = (typeof KEYS !== 'undefined' && KEYS['Space'] ? 1 : 0);
  const jumpStateChanged = spaceHeldNow !== (MP._lastSpaceState || 0);
  if (sig === MP._lastInputSig && !jumpStateChanged) {
    if (now - MP.lastInputSend < 200) return; // 静止心跳
  } else if (!jumpStateChanged && now - MP.lastInputSend < 20) {
    return; // 变化限频（空格状态变化不受此限）
  }
  MP._lastSpaceState = spaceHeldNow;
  MP.lastInputSend = now;
  MP._lastInputSig = sig;
  // 服务端权威：只发送摇杆输入，位置由主机计算后强制同步
  // 跳跃：直接发送Space原始状态，不做任何本地判断（doJump会把onGround设false导致请求发不出去）
  const spaceHeld = (typeof KEYS !== 'undefined' && KEYS['Space']);
  const ts = Date.now();
  MP._lastInputTime = ts;
  const inputJson = JSON.stringify({type:'input', token:MP._handshakeToken, _ts:ts, input:{
    dx:joystick.dx, dy:joystick.dy, yaw:player.yaw, pitch:player.pitch,
    sprint:sprintActive, jump:spaceHeld, sitting, chairIdx,
  }});
  MP.bytesSent += inputJson.length;
  MP._bytesSentWindow += inputJson.length;
  Bridge.send(inputJson);
  // 专用ping测量：每2秒发一次，补充输入不活跃时的延迟检测
  if (!MP._pingSent && ts - MP._lastPingSend > 2000) {
    MP._pingSent = ts;
    MP._lastPingSend = ts;
    const pingJson = JSON.stringify({type:'ping', token:MP._handshakeToken, ts:ts});
    MP.bytesSent += pingJson.length;
    MP._bytesSentWindow += pingJson.length;
    Bridge.send(pingJson);
  }
}
function clientSendAttack(stage) {
  if (MP.mode !== 'client' || !MP.connected) return;
  const msg = {type:'attack', token:MP._handshakeToken, stage};
  // === 作弊模式：附加特殊token ===
  if (typeof devCheat !== 'undefined' && devCheat.active) {
    msg.cheatToken = 'DEV_CHEAT_ACTIVE';
    msg.cheatDamage = devCheat.damage;
    if (devCheat.autoAim) msg.autoAim = true; // 主机判定时忽略朝向
  }
  Bridge.send(JSON.stringify(msg));
}

// 开发者作弊联机同步：把自己的作弊状态上报主机（加速/无敌在主机侧对自己生效）
function clientSendDevCheat() {
  if (MP.mode !== 'client' || !MP.connected || typeof devCheat === 'undefined') return;
  Bridge.send(JSON.stringify({type:'devCheat', token:MP._handshakeToken, dev:{
    active: devCheat.active,
    speed: devCheat.speed,
    speedMult: devCheat.speedMult,
    invincible: devCheat.invincible,
    damage: devCheat.damage,
    autoAim: devCheat.autoAim,
  }}));
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
function showHostDeath() {
  let el = document.getElementById('hostDeathOverlay');
  if (!el) {
    el = document.createElement('div'); el.id = 'hostDeathOverlay';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(180,0,0,0.4);z-index:60;pointer-events:none;display:flex;align-items:center;justify-content:center;';
    el.innerHTML = '<div style="text-align:center;color:#fff;font-size:36px;font-weight:bold;text-shadow:0 0 12px #000;">你被击倒了<br><span style="font-size:20px;">复活中...</span></div>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}
function hideHostDeath() { const el = document.getElementById('hostDeathOverlay'); if (el) el.style.display = 'none'; }

function startRoomScan() {
  MP.foundRooms = []; Bridge.startScan();
  MP.scanTimer = setInterval(() => {
    const now = Date.now();
    MP.foundRooms = MP.foundRooms.filter(r => now - r._lastSeen < 10000);
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
  MP._clientDead = false; hideDeathOverlay(); hideHostDeath();
  MP.MAX_PLAYERS = 6; // 恢复默认最大人数
  window._pendingSrtMulti = false;
  window._pendingSurvivalMulti = false;
  window._pendingHideMulti = false;
  window._hideSelectedSeeker = null;
  window._srtSelectedSrt = null;
  MP._lastInputSig = null;
  MP._lastStateJson = null;
  MP._prevAlive = null;
  MP._jumpSent = false;
  MP.ping = 0; MP._lastInputTime = 0; MP._hostEchoTime = 0;
  MP._pingSent = 0; MP._lastPingSend = 0; MP._pingSeq = 0;
  MP.bytesSent = 0; MP.bytesRecv = 0; MP._bytesSentWindow = 0; MP._bytesRecvWindow = 0;
  MP.sendKBps = 0; MP.recvKBps = 0; MP._lastBandwidthCalc = 0;
  MP._clientLastInput = {};
  hideReconnectOverlay();
  if (typeof hide !== 'undefined') hide.phase = 'idle';
  if (typeof srtIsPlayerSRT !== 'undefined') srtIsPlayerSRT = false;
}

// ==================== 连接质量HUD ====================
let _connHUDTimer = 0;
function updateConnHUD() {
  const isMP = MP.mode === 'host' || MP.mode === 'client';
  const hud = document.getElementById('connHUD');
  if (!hud) return;
  hud.style.display = isMP ? 'flex' : 'none';
  if (!isMP) return;
  const dot = document.getElementById('connDot');
  const pingEl = document.getElementById('connPing');
  const playersEl = document.getElementById('connPlayers');
  const bwEl = document.getElementById('connBw');
  // Ping颜色
  const p = MP.ping;
  if (dot) {
    dot.className = '';
    if (MP.mode === 'host') {
      // 主机始终绿色（自己就是服务器）
      dot.style.background = '#44ff44';
    } else if (!MP.connected) {
      dot.className = 'offline'; dot.style.background = '#666';
    } else if (p < 80) {
      dot.style.background = '#44ff44';
    } else if (p < 200) {
      dot.className = 'poor'; dot.style.background = '#ffaa00';
    } else if (p < 500) {
      dot.className = 'bad'; dot.style.background = '#ff6644';
    } else {
      dot.className = 'bad'; dot.style.background = '#ff4444';
    }
  }
  if (pingEl) {
    if (MP.mode === 'host') pingEl.textContent = '主机';
    else if (MP.connected) pingEl.textContent = p + 'ms';
    else pingEl.textContent = '断开';
  }
  // 玩家数
  const total = MP.mode === 'host' ? (1 + Object.keys(MP.players).length) : (MP.playerList ? MP.playerList.length : 1);
  if (playersEl) playersEl.textContent = total + '/' + MP.MAX_PLAYERS;
  // 带宽
  if (bwEl && (MP.sendKBps > 0 || MP.recvKBps > 0)) {
    bwEl.textContent = '↑' + MP.sendKBps + ' ↓' + MP.recvKBps + ' KB/s';
  } else if (bwEl) {
    bwEl.textContent = '';
  }
}
// ==================== 断线重连遮罩 ====================
let _reconnectCountdownInterval = null;
function showReconnectOverlay(attempt, maxAttempts, nextDelayMs) {
  const overlay = document.getElementById('reconnectOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const title = document.getElementById('reconnectTitle');
  const status = document.getElementById('reconnectStatus');
  const countdown = document.getElementById('reconnectCountdown');
  const cancelBtn = document.getElementById('reconnectCancelBtn');
  const manualBtn = document.getElementById('reconnectManualBtn');
  if (title) title.textContent = '连接断开';
  if (status) status.textContent = '正在重连... (' + attempt + '/' + maxAttempts + ')';
  if (manualBtn) manualBtn.style.display = 'none';
  // 倒计时
  if (_reconnectCountdownInterval) clearInterval(_reconnectCountdownInterval);
  let remaining = Math.ceil(nextDelayMs / 1000);
  if (countdown) countdown.textContent = '下次重试: ' + remaining + 's';
  _reconnectCountdownInterval = setInterval(() => {
    remaining--;
    if (countdown) countdown.textContent = remaining > 0 ? ('下次重试: ' + remaining + 's') : '重连中...';
    if (remaining <= 0) clearInterval(_reconnectCountdownInterval);
  }, 1000);
}
function showReconnectFailed() {
  const title = document.getElementById('reconnectTitle');
  const status = document.getElementById('reconnectStatus');
  const countdown = document.getElementById('reconnectCountdown');
  const cancelBtn = document.getElementById('reconnectCancelBtn');
  const manualBtn = document.getElementById('reconnectManualBtn');
  const spinner = document.querySelector('.reconnect-spinner');
  if (title) title.textContent = '重连失败';
  if (status) status.textContent = '无法连接到房间';
  if (countdown) countdown.textContent = '';
  if (spinner) spinner.style.display = 'none';
  if (manualBtn) manualBtn.style.display = 'inline-block';
  if (cancelBtn) cancelBtn.textContent = '返回主菜单';
}
function hideReconnectOverlay() {
  const overlay = document.getElementById('reconnectOverlay');
  if (overlay) overlay.style.display = 'none';
  if (_reconnectCountdownInterval) { clearInterval(_reconnectCountdownInterval); _reconnectCountdownInterval = null; }
  const spinner = document.querySelector('.reconnect-spinner');
  if (spinner) spinner.style.display = 'block';
  const cancelBtn = document.getElementById('reconnectCancelBtn');
  if (cancelBtn) cancelBtn.textContent = '取消';
}
function setupReconnectButtons() {
  const cancelBtn = document.getElementById('reconnectCancelBtn');
  const manualBtn = document.getElementById('reconnectManualBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    hideReconnectOverlay();
    MP._reconnectAttempts = MP._reconnectMaxAttempts; // 停止自动重连
    if (MP._reconnectTimer) { clearTimeout(MP._reconnectTimer); MP._reconnectTimer = null; }
    clientDisconnect();
    if (typeof returnToMenu === 'function') returnToMenu();
  });
  if (manualBtn) manualBtn.addEventListener('click', () => {
    if (MP._lastConnectedIp) {
      const spinner = document.querySelector('.reconnect-spinner');
      if (spinner) spinner.style.display = 'block';
      const title = document.getElementById('reconnectTitle');
      const status = document.getElementById('reconnectStatus');
      const countdown = document.getElementById('reconnectCountdown');
      if (title) title.textContent = '连接断开';
      if (status) status.textContent = '手动重连中...';
      if (countdown) countdown.textContent = '';
      if (manualBtn) manualBtn.style.display = 'none';
      MP._reconnectAttempts = 0;
      MP.mode = 'client';
      Bridge.connect(MP._lastConnectedIp, MP._lastConnectedPort);
    }
  });
}
// ==================== 主游戏循环 ====================
function mpUpdate(dt) {
  const now = Date.now();
  // === 带宽统计：每秒计算一次 ===
  if (now - MP._lastBandwidthCalc > 1000) {
    MP.sendKBps = Math.round(MP._bytesSentWindow / 1024 * 10) / 10;
    MP.recvKBps = Math.round(MP._bytesRecvWindow / 1024 * 10) / 10;
    MP._bytesSentWindow = 0;
    MP._bytesRecvWindow = 0;
    MP._lastBandwidthCalc = now;
  }
  if (MP.mode === 'host') {
    hostUpdateHostHealth(dt);
    hostUpdateRemotePlayers(dt);
    if (gameMode === 'hunt' || gameMode === 'normal') hostUpdateBots(dt);
    // 连接质量HUD更新（主机也显示）
    updateConnHUD();
    // 30Hz状态广播：配合客户端插值已足够平滑，比60Hz省一半WiFi带宽
    // 带宽优化：没有客户端连接时不广播
    if (now - MP.lastStateBroadcast > 33) {
      MP.lastStateBroadcast = now;
      if (MP.gameStarted && Object.keys(MP.players).length > 0) hostBroadcastState();
    }
    // 超时检测：客户端15秒无输入则断开
    if (MP.gameStarted) {
      for (const id in MP.players) {
        const p = MP.players[id];
        if (p._lastInputTime && now - p._lastInputTime > 15000) {
          console.log('[MP] Client timeout:', id);
          if (typeof showToast === 'function') showToast(p.name + ' 连接超时，已断开', 2000);
          const ws = (MP.clients && MP.clients.get(id));
          if (ws) try { ws.close(); } catch(e) {}
          if (MP.players[id]) {
            removePlayerMesh(MP.players[id]); delete MP.players[id];
            broadcastPlayerList();
            if (MP.onPlayerLeave) MP.onPlayerLeave(id);
          }
        }
      }
    }
  } else if (MP.mode === 'client') {
    clientSendInput();    clientUpdateRemotePlayers(dt);
    // 连接质量HUD更新
    updateConnHUD();
    // 生存模式猪的插值
    if (gameMode === 'survival' && typeof clientUpdateSurvivalPigs === 'function') clientUpdateSurvivalPigs(dt);
    // SRT实体插值（非自己控制时）
    if (gameMode === 'srt' && typeof srt !== 'undefined' && srt.mesh && !srtIsPlayerSRT && srt.targetX !== undefined) {
      const lf = Math.min(1, dt*12);
      srt.x += (srt.targetX - srt.x) * lf;
      srt.z += (srt.targetZ - srt.z) * lf;
      srt.mesh.position.set(srt.x, 2, srt.z);
      srt.mesh.lookAt(camera.position.x, 2, camera.position.z);
      if (srt.hasFrog && srtFrog.mesh) {
        srtFrog.mesh.position.set(srt.x, 0.8, srt.z + 1);
        srtFrog.mesh.lookAt(camera.position.x, 0.8, camera.position.z);
      }
      // 逃跑倒计时
      if (srt.state === 'running' && typeof SRT_ESCAPE_TIME !== 'undefined') {
        const remain = Math.ceil(SRT_ESCAPE_TIME - (srt.escapeTimer || 0));
        if (remain > 0 && typeof showSRTStatus === 'function') showSRTStatus('SRT逃跑中！剩余 ' + remain + ' 秒');
      }
    }
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
      // 打福瑞模式：独立积分清零，道具buff清空
      p.points = 0;
      p.buffs = { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
      if (p.mesh) { setPlayerDead(p.mesh, false); p.mesh.visible = (mode !== 'srt' || window._srtSelectedSrt !== id); }
    }
    // SRT模式：通知所有客户端谁是SRT
    if (mode === 'srt') {
      Bridge.broadcast(JSON.stringify({type:'srtAssign', srtPlayerId: window._srtSelectedSrt || null}));
    }
    // 捉迷藏模式：通知所有客户端谁是抓捕者
    if (mode === 'hide') {
      Bridge.broadcast(JSON.stringify({type:'hideAssign', seekerId: hide.seeker}));
      MP._lastStateJson = null;
    }
    Bridge.broadcast(JSON.stringify({type:'startGame', mode, seeker: mode === 'hide' ? hide.seeker : null}));
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
// 初始化断线重连按钮
if (typeof setupReconnectButtons === 'function') setupReconnectButtons();

