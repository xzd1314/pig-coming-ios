// ==================== 黑猪模式场地构建 ====================
function buildBlackpigMap() {
  // 隐藏原有迷宫
  hideMaze();
  // 黑猪模式下隐藏黑雾，保存原始fog以便恢复
  originalFog = scene.fog;
  scene.fog = null;
  // 创建空旷场地
  const fieldGeo = new THREE.PlaneGeometry(blackpigFieldSize, blackpigFieldSize);
  const fieldMat = new THREE.MeshStandardMaterial({color:0x999988, roughness:0.9});
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.rotation.x = -Math.PI/2; field.position.set(0,0,0); field.name = 'bp_field';
  scene.add(field);
  // 讲台（AI生成素材，billboard平面），移近到z=-12
  const texLoader = new THREE.TextureLoader();
  const podiumTex = texLoader.load(IMG_PODIUM_PNG, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const podiumMat = new THREE.MeshBasicMaterial({map:podiumTex, transparent:true, alphaTest:0.1, side:THREE.DoubleSide});
  const podiumGeo = new THREE.PlaneGeometry(5, 5);
  blackpig.podiumMesh = new THREE.Mesh(podiumGeo, podiumMat);
  blackpig.podiumMesh.position.set(0, 2.5, -12);
  blackpig.podiumMesh.name = 'bp_podium';
  scene.add(blackpig.podiumMesh);
  // 黑猪，移近到z=-12
  blackpig.frontTex = texLoader.load(IMG_BLACKPIG_FRONT_PNG, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  blackpig.backTex = texLoader.load(IMG_BLACKPIG_BACK_PNG, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const bpMat = new THREE.MeshBasicMaterial({map:blackpig.backTex, transparent:true, alphaTest:0.1, side:THREE.DoubleSide});
  const bpGeo = new THREE.PlaneGeometry(4, 4);
  blackpig.mesh = new THREE.Mesh(bpGeo, bpMat);
  blackpig.mesh.position.set(0, 6, -12);
  blackpig.mesh.name = 'bp_blackpig';
  scene.add(blackpig.mesh);
  // 课桌椅（AI生成素材，billboard平面），创建6把椅子支持多人
  const deskTex = texLoader.load(IMG_DESK_CHAIR_PNG, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const deskMat = new THREE.MeshBasicMaterial({map:deskTex, transparent:true, alphaTest:0.1, side:THREE.DoubleSide});
  const deskGeo = new THREE.PlaneGeometry(3, 3.3);
  deskChairs = [];
  // 6把椅子排成两排，每排3把
  const chairPositions = [
    {x:-8, z:8}, {x:0, z:8}, {x:8, z:8},
    {x:-8, z:16}, {x:0, z:16}, {x:8, z:16},
  ];
  for (let i = 0; i < 6; i++) {
    const deskMesh = new THREE.Mesh(deskGeo, deskMat);
    deskMesh.position.set(chairPositions[i].x, 1.65, chairPositions[i].z);
    deskMesh.name = 'bp_desk';
    scene.add(deskMesh);
    deskChairs.push({ mesh: deskMesh, x: chairPositions[i].x, z: chairPositions[i].z, isSitting: false, occupiedBy: null });
  }
  // 兼容旧代码：第一把椅子
  deskChair = deskChairs[0];
}
// 释放mesh资源（几何体/材质/纹理），防止反复进出模式造成GPU内存泄漏
function disposeMesh(obj) {
  if (!obj) return;
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}
function clearBlackpigMap() {
  const names = ['bp_field','bp_podium','bp_blackpig','bp_desk'];
  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (names.includes(scene.children[i].name)) {
      const m = scene.children[i];
      scene.remove(m);
      disposeMesh(m);
    }
  }
  blackpig.mesh = null; blackpig.podiumMesh = null; blackpig.frontTex = null; blackpig.backTex = null;
  deskChairs = []; deskChair = { mesh: null, x: 0, z: 0, isSitting: false };
  if (originalFog) { scene.fog = originalFog; originalFog = null; }
  showMaze();
}
function buildEmptyArena() {
  hideMaze();
  originalFog = scene.fog;
  scene.fog = null;
  const fieldGeo = new THREE.PlaneGeometry(blackpigFieldSize, blackpigFieldSize);
  const fieldMat = new THREE.MeshStandardMaterial({color:0x445566, roughness:0.9});
  const field = new THREE.Mesh(fieldGeo, fieldMat);
  field.rotation.x = -Math.PI/2; field.position.set(0,0,0); field.name = 'bp_field';
  scene.add(field);
  const wallMat = new THREE.MeshBasicMaterial({color:0x223344, transparent:true, opacity:0.6});
  const half = blackpigFieldSize/2;
  const arenaWalls = [
    {x:0, z:-half, ry:0}, {x:0, z:half, ry:0},
    {x:-half, z:0, ry:Math.PI/2}, {x:half, z:0, ry:Math.PI/2},
  ];
  for (const w of arenaWalls) {
    const wg = new THREE.PlaneGeometry(blackpigFieldSize, 5);
    const wm = new THREE.Mesh(wg, wallMat);
    wm.position.set(w.x, 2.5, w.z); wm.rotation.y = w.ry; wm.name = 'bp_field';
    scene.add(wm);
  }
}

// SRT模式地图
function buildSRTMap() {
  hideMaze();
  originalFog = scene.fog;
  originalBackground = scene.background;
  scene.fog = null;
  scene.background = new THREE.Color(0x87CEEB); // 白天天空蓝
  // 地板用srt_floor.jpg
  const floorTex = new THREE.TextureLoader().load(SRT_FLOOR_TEX_DATA, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 4);
  const floorGeo = new THREE.PlaneGeometry(SRT_FIELD_SIZE, SRT_FIELD_SIZE);
  const floorMat = new THREE.MeshStandardMaterial({map: floorTex, roughness:0.8});
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.set(0,0,0); floor.name = 'srt_map';
  scene.add(floor);
  // 白天光照
  if (ambientLight) ambientLight.intensity = 0.8;
  if (dirLight) { dirLight.intensity = 1.0; dirLight.position.set(10, 20, 10); }
  if (typeof showSkyElements === 'function') showSkyElements(true);
  srtMapBuilt = true;
}
function clearSRTMap() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (scene.children[i].name === 'srt_map') {
      const m = scene.children[i];
      scene.remove(m);
      disposeMesh(m);
    }
  }
  if (srt.mesh) { scene.remove(srt.mesh); disposeMesh(srt.mesh); srt.mesh = null; }
  if (srtFrog.mesh) { scene.remove(srtFrog.mesh); disposeMesh(srtFrog.mesh); srtFrog.mesh = null; }
  if (originalFog) { scene.fog = originalFog; originalFog = null; }
  scene.background = originalBackground;
  originalBackground = null;
  if (ambientLight) ambientLight.intensity = 0.55;
  if (dirLight) dirLight.intensity = 0.4;
  if (typeof showSkyElements === 'function') showSkyElements(false);
  srtMapBuilt = false;
}
function createSRTEntity() {
  const tex = new THREE.TextureLoader().load(SRT_ENTITY_TEX_DATA, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const mat = new THREE.MeshBasicMaterial({map: tex, transparent: true, side: THREE.DoubleSide});
  const geo = new THREE.PlaneGeometry(4, 4);
  srt.mesh = new THREE.Mesh(geo, mat);
  srt.mesh.position.set(srt.x, 2, srt.z);
  srt.mesh.name = 'srt_entity';
  srt.mesh.renderOrder = 10;
  scene.add(srt.mesh);
}
// 兼容旧名称（防止外部引用断裂）
function createSRTRntity() { return createSRTEntity(); }
function createFrog() {
  // 青蛙用图片
  const frogTex = new THREE.TextureLoader().load(SRT_FROG_TEX_DATA, t=>{t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const frogMat = new THREE.MeshBasicMaterial({map: frogTex, transparent: true, side: THREE.DoubleSide});
  const frogGeo = new THREE.PlaneGeometry(1.5, 1.5);
  srtFrog.mesh = new THREE.Mesh(frogGeo, frogMat);
  srtFrog.mesh.position.set(srtFrog.x, 0.8, srtFrog.z);
  srtFrog.mesh.name = 'srt_frog';
  srtFrog.mesh.renderOrder = 11;
  scene.add(srtFrog.mesh);
}

// SRT游戏逻辑
function srtInit() {
  srt.health = 100; srt.alive = true; srt.hasFrog = false; srt.state = 'seekingFrog';
  srt.moveTimer = 0; srt.targetX = undefined; srt.targetZ = undefined; srt.escapeTimer = 0;
  // SRT和玩家出生在同一个地方附近
  srt.x = 3; srt.z = 0;
  // 青蛙放在离出生点不远的地方
  srtFrog.x = (Math.random()-0.5)*8; srtFrog.z = 8 + Math.random()*4;
  srtFrog.collected = false;
  srtIsPlayerSRT = false;
  if (srtAudio) { srtAudio.pause(); srtAudio.currentTime = 0; }
  document.getElementById('srtOKBtn').style.display = 'none';
  document.getElementById('srtStatus').style.display = 'none';
}
function srtUpdate(dt) {
  if (!srt.alive || !srt.mesh) return;
  // 多人模式下SRT由玩家控制，不自动移动
  if (srtIsPlayerSRT) {
    srt.mesh.position.set(srt.x, 2, srt.z);
    if (srt.hasFrog) {
      const dx = player.x - srt.x, dz = player.z - srt.z;
      srt.mesh.rotation.y = Math.atan2(dx, dz);
    }
    return;
  }
  // 主机端：SRT由客户端控制时，主机不跑AI，但处理逃跑超时
  if (MP.mode === 'host' && window._srtSelectedSrt && window._srtSelectedSrt !== 'host') {
    if (srt.mesh) {
      srt.mesh.position.set(srt.x, 2, srt.z);
      srt.mesh.lookAt(player.x, 2, player.z);
    }
    if (srt.state === 'running') {
      srt.escapeTimer += dt;
      if (srt.escapeTimer >= SRT_ESCAPE_TIME) { srtGameOver(false); return; }
    }
    if (srt.hasFrog && srtFrog.mesh) {
      srtFrog.mesh.position.set(srt.x, 0.8, srt.z+1);
    }
    return;
  }
  if (srt.state === 'seekingFrog') {
    // SRT跑向青蛙
    const dx = srtFrog.x - srt.x, dz = srtFrog.z - srt.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < 2.0) {
      srt.hasFrog = true; srt.state = 'running';
      srtFrog.collected = true; srt.escapeTimer = 0;
      if (srtFrog.mesh) srtFrog.mesh.visible = true;
      // 开始播放音频
      if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
      srtAudio.loop = true; srtAudio.volume = 0.8; srtAudio.play().catch(()=>{});
      showSRTStatus('SRT拿到青蛙了！追杀它！');
    } else {
      const speed = Math.min(2.5 * settings.pigSpeed, 6.0);
      srt.x += (dx/dist) * speed * dt;
      srt.z += (dz/dist) * speed * dt;
    }
  } else if (srt.state === 'running') {
    // SRT逃跑：用目标点系统，每隔一段时间选一个场地内的目标点
    const half = SRT_FIELD_SIZE/2 - 4;
    srt.moveTimer -= dt;
    if (srt.moveTimer <= 0 || srt.targetX === undefined) {
      srt.moveTimer = 1.0 + Math.random() * 1.5;
      // 选一个远离玩家的目标点，确保在场地内
      const dx = srt.x - player.x, dz = srt.z - player.z;
      const awayAngle = Math.atan2(dx, dz);
      const randomOffset = (Math.random() - 0.5) * 2.0;
      const moveAngle = awayAngle + randomOffset;
      const targetDist = 8 + Math.random() * 12;
      let tx = srt.x + Math.sin(moveAngle) * targetDist;
      let tz = srt.z + Math.cos(moveAngle) * targetDist;
      // 如果目标点超出边界，就朝场地中心
      if (tx < -half || tx > half || tz < -half || tz > half) {
        tx = (Math.random() - 0.5) * half * 0.6;
        tz = (Math.random() - 0.5) * half * 0.6;
      }
      srt.targetX = tx;
      srt.targetZ = tz;
    }
    // 朝目标点移动
    const tdx = srt.targetX - srt.x, tdz = srt.targetZ - srt.z;
    const tdist = Math.sqrt(tdx*tdx + tdz*tdz);
    if (tdist > 0.5) {
      const speed = Math.min(4.0 * settings.pigSpeed, 8.0);
      srt.x += (tdx/tdist) * speed * dt;
      srt.z += (tdz/tdist) * speed * dt;
    }
    // 严格边界
    srt.x = Math.max(-half, Math.min(half, srt.x));
    srt.z = Math.max(-half, Math.min(half, srt.z));
    // 逃跑超时：SRT存活足够久则逃跑成功（玩家失败）
    srt.escapeTimer += dt;
    const remain = Math.ceil(SRT_ESCAPE_TIME - srt.escapeTimer);
    if (srt.escapeTimer >= SRT_ESCAPE_TIME) { srtGameOver(false); return; }
    if (srt.mesh) {
      const st = document.getElementById('srtStatus');
      if (st && st.dataset.remain !== String(remain)) {
        st.dataset.remain = String(remain);
        showSRTStatus('SRT逃跑中！剩余 ' + remain + ' 秒');
      }
    }
  }
  // 更新mesh位置，始终面向玩家（billboard）
  if (srt.mesh) {
    srt.mesh.position.set(srt.x, 2, srt.z);
    srt.mesh.lookAt(player.x, 2, player.z);
    srt.mesh.visible = true;
  }
  // 青蛙跟随SRT
  if (srt.hasFrog && srtFrog.mesh) {
    srtFrog.mesh.position.set(srt.x, 0.8, srt.z + 1);
    srtFrog.mesh.lookAt(player.x, 0.8, player.z);
  }
  // 青蛙未被拿时也面向玩家
  if (!srtFrog.collected && srtFrog.mesh) {
    srtFrog.mesh.lookAt(player.x, 0.8, player.z);
  }
}
function updateSRTHealthBar() {
  const bar = document.getElementById('srtHealthBar');
  const fill = document.getElementById('srtHpFill');
  const text = document.getElementById('srtHpText');
  if (!bar || !fill || !text) return;
  if (gameMode === 'srt' && gameRunning && srt.alive) {
    bar.style.display = 'block';
    const pct = Math.max(0, srt.health);
    fill.style.width = pct + '%';
    text.textContent = Math.max(0, Math.round(srt.health)) + '/100';
  } else {
    bar.style.display = 'none';
  }
}
function srtTakeDamage(dmg) {
  if (!srt.alive) return;
  srt.health -= dmg;
  updateSRTHealthBar();
  if (srt.health <= 0) {
    srt.alive = false;
    if (typeof spawnKillBurst === 'function') spawnKillBurst(srt.x, 2, srt.z, 0xffdd44);
    if (srt.mesh && typeof animateDeath === 'function') animateDeath(srt.mesh);
    else if (srt.mesh) srt.mesh.visible = false;
    if (srtAudio) { srtAudio.pause(); srtAudio.currentTime = 0; }
    showSRTStatus('SRT被击败！');
    setTimeout(() => { srtGameOver(true); }, 1500);
  }
}
function showSRTStatus(text) {
  const el = document.getElementById('srtStatus');
  el.textContent = text;
  el.style.display = 'block';
}
function srtGameOver(win) {
  gameRunning = false;
  if (srtAudio) { srtAudio.pause(); srtAudio.currentTime = 0; }
  document.getElementById('srtOKBtn').style.display = 'none';
  document.getElementById('srtStatus').style.display = 'none';
  document.getElementById('srtHealthBar').style.display = 'none';
  // 隐藏游戏HUD，避免结算画面透出
  document.getElementById('hud').style.display = 'none';
  document.getElementById('distance').style.display = 'none';
  document.getElementById('attackBtn').style.display = 'none';
  document.getElementById('hotbar').style.display = 'none';
  document.getElementById('healthBarContainer').style.display = 'none';
  document.getElementById('punishOverlay').style.display = 'none';
  document.getElementById('dangerOverlay').style.opacity = '0';
  // 联机主机：广播胜负
  if (MP.mode === 'host') {
    Bridge.broadcast(JSON.stringify({type:'srtEvent', event: win ? 'win' : 'lose'}));
  }
  const goScreen = document.getElementById('gameOverScreen');
  // win=true 表示SRT被击败；SRT玩家视角相反
  const myWin = srtIsPlayerSRT ? !win : win;
  goScreen.querySelector('h1').textContent = myWin ? '胜利！' : '失败';
  goScreen.querySelector('.time-text').textContent = myWin
    ? (srtIsPlayerSRT ? '你成功逃跑了！' : '你成功击败了SRT')
    : (srtIsPlayerSRT ? '你被击败了' : 'SRT逃跑了');
  goScreen.querySelector('.best-text').textContent = '';
  goScreen.style.display = 'flex';
}
// SRT玩家控制（多人模式）
function srtPlayerUpdate(dt) {
  if (!srtIsPlayerSRT || !srt.alive) return;
  // 用摇杆控制SRT移动
  if (joystick.active) {
    const speed = Math.min((sprintActive ? 7.0 : 4.5) * (settings.pigSpeed || 1), 12.0) * devSpeedMult();
    const fwd = {x:-Math.sin(player.yaw), z:-Math.cos(player.yaw)};
    const right = {x:Math.cos(player.yaw), z:-Math.sin(player.yaw)};
    srt.x += (fwd.x*joystick.dy + right.x*joystick.dx)*speed*dt;
    srt.z += (fwd.z*joystick.dy + right.z*joystick.dx)*speed*dt;
    const half = SRT_FIELD_SIZE/2 - 2;
    srt.x = Math.max(-half, Math.min(half, srt.x));
    srt.z = Math.max(-half, Math.min(half, srt.z));
  }
  // 检查是否拿到青蛙（仅主机端本地判定；客户端等主机广播frogTaken，避免位置不同步误触发）
  if (MP.mode === 'host' && !srt.hasFrog && !srtFrog.collected) {
    const dx = srtFrog.x - srt.x, dz = srtFrog.z - srt.z;
    if (Math.sqrt(dx*dx+dz*dz) < 2) {
      srt.hasFrog = true;
      srtFrog.collected = true;
      srt.escapeTimer = 0;
      if (srtFrog.mesh) srtFrog.mesh.visible = true;
      document.getElementById('srtOKBtn').style.display = 'block';
      showSRTStatus('你拿到青蛙了！点OK开始');
      if (typeof Bridge !== 'undefined') {
        if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
        Bridge.broadcast(JSON.stringify({type:'srtEvent', event:'frogTaken'}));
      }
    }
  }
  // 主机端SRT玩家：逃跑超时判定
  if (MP.mode === 'host' && srt.state === 'running') {
    srt.escapeTimer += dt;
    if (srt.escapeTimer >= SRT_ESCAPE_TIME) { srtGameOver(false); return; }
  }
  // 客户端SRT玩家：显示主机同步的逃跑倒计时
  if (MP.mode === 'client' && srt.state === 'running') {
    const remain = Math.max(0, Math.ceil(SRT_ESCAPE_TIME - srt.escapeTimer));
    const st = document.getElementById('srtStatus');
    if (st && st.dataset.remain !== String(remain)) {
      st.dataset.remain = String(remain);
      showSRTStatus('逃跑中！剩余 ' + remain + ' 秒');
    }
  }
}


function clearEmptyArena() {
  for (let i = scene.children.length - 1; i >= 0; i--) {
    if (scene.children[i].name === 'bp_field') {
      const m = scene.children[i];
      scene.remove(m);
      disposeMesh(m);
    }
  }
  if (originalFog) { scene.fog = originalFog; originalFog = null; }
  showMaze();
}
// 黑猪换面
function blackpigTurn() {
  if (blackpig.isTurning) return;
  blackpig.isTurning = true;
  // 播放换面音效，完了才换面并播放对应音乐
  bpStopAll();
  bpAudioQueue.push({audio:sfxBpTurn, duration:1.5, callback:()=>{
    blackpig.isWatching = !blackpig.isWatching;
    if (blackpig.mesh) {
      blackpig.mesh.material.map = blackpig.isWatching ? blackpig.frontTex : blackpig.backTex;
      blackpig.mesh.material.needsUpdate = true;
    }
    // 设置随机保持时间 3-10秒
    blackpig.turnDuration = 3 + Math.random() * 7;
    blackpig.turnTimer = blackpig.turnDuration;
    blackpig.isTurning = false;
    // 联机：换面后立即广播，不等轮询
    if (MP.mode === 'host' && typeof hostBroadcastState === 'function') hostBroadcastState();
    // 播放正面或反面音乐（已调换：看着你播放反面音效，没看着你播放正面音效）
    if (blackpig.isWatching) {
      bpAudioQueue.push({audio:sfxBpBack, duration:8});
    } else {
      bpAudioQueue.push({audio:sfxBpFront, duration:8});
    }
    bpPlayQueue();
    updateBlackpigStatusUI();
  }});
  bpPlayQueue();
}
function updateBlackpigStatusUI() {
  const el = document.getElementById('blackpigStatus');
  if (gameMode !== 'blackpig' || !gameRunning) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  if (blackpig.isTurning) {
    el.textContent = '换面中...'; el.className = ''; el.style.color = '#ffaa00';
  } else if (blackpig.isWatching) {
    el.textContent = '黑猪看着你！'; el.className = 'watching';
  } else {
    el.textContent = '黑猪没看你'; el.className = 'notwatching';
  }
}
