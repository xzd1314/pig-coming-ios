// ==================== 全局UI重置（防止残留） ====================
function resetAllUI() {
  // 隐藏所有菜单/弹窗
  const allScreens = ['startScreen','gameOverScreen','modeSelectScreen','playerSelectScreen',
    'srtSubMenu','srtMultiLobby','aboutScreen','settingsPanel','multiplayerScreen',
    'nameDialog','ipDialog','survivalSubMenu','survivalMultiLobby','survivalShop',
    'devCheatPanel','devPasswordDialog','mpWaitScreen','hideSubMenu','hideMultiLobby','myInfoScreen',
    'pigshootSubMenu','pvpgunSubMenu'];
  for (const id of allScreens) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  // 隐藏所有游戏HUD
  const allHud = ['hud','distance','healthBarContainer','pigHealthBarContainer',
    'attackBtn','hotbar','srtStatus','srtHealthBar','srtOKBtn',
    'survivalWaveInfo','survivalPoints','survivalShopBtn',
    'blackpigStatus','punishOverlay','pauseLabel','dangerOverlay','gasOverlay','hitFlash',
    'hideInfo','hideBlackout',
    'gunCrosshair','gunAmmo','gunWaveInfo','gunFireBtn','gunReloadBtn','gunSwitchBtn'];
  for (const id of allHud) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  // 隐藏Canvas
  const gc = document.getElementById('gameCanvas');
  if (gc) gc.style.display = 'none';
}
// ==================== 游戏控制 ====================
function showPlayerSelect() {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('playerSelectScreen').style.display = 'flex';
}
function showModeSelect() {
  document.getElementById('playerSelectScreen').style.display = 'none';
  document.getElementById('modeSelectScreen').style.display = 'flex';
}
function startGame(mode) {
  resetAllUI();
  const gc = document.getElementById('gameCanvas'); if (gc) gc.style.display = 'block';
  document.getElementById('hud').style.display = 'block';
  document.getElementById('distance').style.display = 'block';
  // 隐藏鼠标锁定提示
  var hint = document.getElementById('pointerLockHint');
  if (hint) hint.style.display = 'none';
  if (typeof hideClientWaitScreen === 'function') hideClientWaitScreen();
  initAudio();
  stopMenuBgm();
  // 清除SRT模式残留UI
  const srtStatusEl = document.getElementById('srtStatus');
  const srtHealthBarEl = document.getElementById('srtHealthBar');
  const srtOKBtnEl = document.getElementById('srtOKBtn');
  if (srtStatusEl) srtStatusEl.style.display = 'none';
  if (srtHealthBarEl) srtHealthBarEl.style.display = 'none';
  if (srtOKBtnEl) srtOKBtnEl.style.display = 'none';
  // 停止所有可能残留的音效
  if (gasAudio && !gasAudio.paused) { gasAudio.pause(); gasAudio.currentTime = 0; }
  gameMode = mode || 'normal';
  recordGameStart(gameMode); // 我的信息：游玩次数+1
  setAmbientDustVisible(gameMode === 'normal' || gameMode === 'hunt');
  // 多人模式：强制开启局域网
  if (window._isMultiplayer && MP.mode === 'offline' && gameMode !== 'srt') {
    MP.onServerReady = (ip, port) => {
      const info = document.getElementById('mpServerInfo');
      if (info) { info.style.display = 'block'; info.textContent = '局域网联机已开启  IP: ' + ip + '  端口: ' + port; }
      const mpToggle = document.getElementById('toggleMultiplayer');
      const mpRow = document.getElementById('mpToggleRow');
      if (mpToggle) mpToggle.classList.add('on');
      if (mpRow) mpRow.classList.add('disabled');
      hostBroadcastRoom();
    };
    MP.onServerError = (err) => {
      const info = document.getElementById('mpServerInfo');
      if (info) { info.style.display = 'block'; info.textContent = '局域网开启失败: ' + err; info.style.color = '#ff4444'; }
    };
    setTimeout(() => { if (typeof hostStartServer === 'function') hostStartServer(); }, 100);
  }
  // 单人模式：确保MP.mode重置为offline（防止之前联机残留导致碰撞逻辑错误）
  // 注意：多人房主服务器正在运行时(MP.serverRunning)绝不能重置，否则会断开多人同步
  if (MP.mode === 'host' && !MP.gameStarted && !MP.serverRunning) {
    // 如果之前开过主机但没开始游戏，重置为offline
    if (typeof hostStopServer === 'function') hostStopServer();
    MP.mode = 'offline';
  }
  // 清理上一局模式残留（先清SRT再清黑猪/空场，避免fog恢复冲突）
  if (srtMapBuilt) clearSRTMap();
  if (hideMapBuilt) clearHideMap();
  clearBlackpigMap();
  bpStopAll();
  if (srtAudio) { srtAudio.pause(); srtAudio.currentTime = 0; }
  // 重置玩家
  player.x = 2*CELL; player.z = 5*CELL;
  player.yaw = 0; player.pitch = 0; player.jumpY = 0; player.vy = 0; player.onGround = true;
  player.tx = undefined; player.tz = undefined; player.tJumpY = 0; // 清除联机位置平滑目标
  // 重置猪
  nextbot.x = 14*CELL; nextbot.z = 1*CELL;
  nextbot.path = []; nextbot.pathTimer = 0; nextbot.health = 100; nextbot.alive = true;
  // 重置打猪模式
  playerHealth = 100; swordEquipped = false; attackStage = 0; attackAnimTimer = 0;
  pigHitCooldown = 0; playerHitCooldown = 0;
  window.pvpKills = 0;
  if (swordGroup) swordGroup.visible = false;
  // 重置黑猪模式
  blackpig.isWatching = false; blackpig.turnTimer = 0; blackpig.turnDuration = 0; blackpig.isTurning = false;
  for (const c of deskChairs) { c.isSitting = false; c.occupiedBy = null; } if (deskChairs.length > 0) deskChair = deskChairs[0]; standUpCooldown = 0;
  window._bpPunishPending = false;
  // 通用
  gameTime = 0; sprintActive = false; sprintTimer = 0; cooldownTimer = 0;
  gamePaused = false; gameRunning = true;
  // 毒气模式
  if (settings.gasMode) { enableGasEffect(); } else { disableGasEffect(); }
  // 模式特定初始化
  if (gameMode === 'blackpig') {
    buildBlackpigMap();
    player.x = 0; player.z = 15;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    setTimeout(() => { if (gameRunning && gameMode === 'blackpig') blackpigTurn(); }, 1000);
  } else if (gameMode === 'pvp') {
    buildEmptyArena();
    player.x = (Math.random()-0.5)*20; player.z = 10 + (Math.random()-0.5)*10;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    playerHealth = 100;
    swordEquipped = true;
    if (swordGroup) swordGroup.visible = true;
  } else if (gameMode === 'srt') {
    settings.dayMode = true; // SRT模式强制白天
    const dayToggle = document.getElementById('toggleDayMode');
    if (dayToggle) dayToggle.classList.add('on');
    buildSRTMap();
    srtInit();
    createSRTEntity();
    createFrog();
    player.x = 0; player.z = 0;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    if (nextbotAudio) { nextbotAudio.pause(); nextbotAudio.currentTime = 0; }
    nextbot.alive = false; // 停止猪的AI
    playerHealth = 100;
    swordEquipped = true;
    if (swordGroup) swordGroup.visible = true;
    // 多人模式：根据主机分配决定谁是SRT
    if (MP.mode !== 'offline' && window._srtSelectedSrt) {
      srtIsPlayerSRT = (window._srtSelectedSrt === (MP.mode === 'host' ? 'host' : MP.myId));
    } else {
      srtIsPlayerSRT = false;
    }
    // SRT玩家不持剑、看不到自己的SRT模型
    if (srtIsPlayerSRT) {
      if (swordGroup) swordGroup.visible = false;
      if (srt.mesh) srt.mesh.visible = false;
    }
    showSRTStatus(srtIsPlayerSRT ? '你是SRT！去拿到青蛙！' : '找到青蛙，让SRT拿到它！');
    updateSRTHealthBar();
  } else if (gameMode === 'survival') {
    // 生存模式：先清理旧猪，再建场地
    if (typeof survivalCleanup === 'function') survivalCleanup();
    buildEmptyArena();
    player.x = 0; player.z = 0;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    if (nextbotAudio) { nextbotAudio.pause(); nextbotAudio.currentTime = 0; }
    nextbot.alive = false;
    playerHealth = 100;
    swordEquipped = true;
    if (swordGroup) swordGroup.visible = true;
    survivalInit();
  } else if (gameMode === 'pigshoot' || gameMode === 'pvpgun') {
    // 枪战模式：空旷场地，猪群(pigshoot)或纯PVP(pvpgun)
    if (typeof gunCleanup === 'function') gunCleanup();
    buildEmptyArena();
    player.x = 0; player.z = 0;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    if (nextbotAudio) { nextbotAudio.pause(); nextbotAudio.currentTime = 0; }
    nextbot.alive = false;
    playerHealth = 100;
    window.pvpKills = 0;
    if (typeof gunInit === 'function') gunInit(gameMode);
  } else if (gameMode === 'hide') {
    // 捉迷藏模式：新地图，抓捕者开局蒙眼10秒
    buildHideMap();
    // 仅房主从本地选择设置抓捕者；客户端的抓捕者身份由 startGame/hideAssign 网络消息下发，
    // 这里绝不能覆盖，否则客户端被选为抓捕者时会被错改成 'host'，导致挥刀按钮不显示
    if (MP.mode !== 'client') {
      hide.seeker = window._hideSelectedSeeker || 'host';
    }
    hide.phase = 'hide';
    hide.timer = HIDE_COUNTDOWN;
    hideBlackoutOn = false;
    nextbot.alive = false;
    if (nextbot.mesh) nextbot.mesh.visible = false;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = false;
    if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
    if (typeof stopSurvivalAudio === 'function') stopSurvivalAudio();
    playerHealth = 100;
    const myId = (MP.mode === 'client') ? MP.myId : 'host';
    const iAmSeeker = (hide.seeker === myId);
    window._hideIAmSeeker = iAmSeeker;
    swordEquipped = iAmSeeker;
    if (swordGroup) {
      swordGroup.visible = !!iAmSeeker;
      swordGroup.renderOrder = 999;
    }
    // 出生点：抓捕者在中央地标前方开阔地，躲藏者随机远离且不与建筑碰撞
    if (iAmSeeker) {
      // 中央地标在(0,-18)，抓捕者站在地标前方(0,-26)开阔处
      player.x = 0; player.z = -26;
    } else {
      const sp = findSafeSpawn(); player.x = sp.x; player.z = sp.z;
    }
    showSRTStatus(iAmSeeker ? '你是抓捕者！蒙眼10秒...' : '你是躲藏者！快躲起来！');
  } else {
    if (nextbot.mesh) nextbot.mesh.visible = true;
    if (nextbot.glowMesh) nextbot.glowMesh.visible = true;
  }
  // UI
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('modeSelectScreen').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  document.getElementById('settingsPanel').style.display = 'none';
  document.getElementById('pauseLabel').style.display = 'none';
  // 模式特定UI
  let showSword = (gameMode === 'hunt' || gameMode === 'pvp' || gameMode === 'srt' || gameMode === 'survival');
  if (gameMode === 'hide') showSword = (window._hideIAmSeeker === true); // 捉迷藏只有抓捕者持剑
  const gunMode = (gameMode === 'pigshoot' || gameMode === 'pvpgun');
  document.getElementById('attackBtn').style.display = (showSword && !gunMode) ? 'flex' : 'none';
  document.getElementById('hotbar').style.display = (showSword && !gunMode) ? 'flex' : 'none';
  document.getElementById('healthBarContainer').style.display = (showSword || gunMode) ? 'block' : 'none';
  document.getElementById('pigHealthBarContainer').style.display = (gameMode === 'hunt') ? 'block' : 'none';
  if (gameMode === 'pvp') document.getElementById('slotSword').classList.add('active');
  // SRT玩家不显示攻击按钮和物品栏
  if (gameMode === 'srt' && srtIsPlayerSRT) {
    document.getElementById('attackBtn').style.display = 'none';
    document.getElementById('hotbar').style.display = 'none';
  }
  updateHealthUI();
  updateBlackpigStatusUI();
  // 联机：通知游戏开始
  if (MP.mode !== 'offline') mpOnGameStart(gameMode);
}
function gameOver(reason) {
  gameRunning = false; gamePaused = false;
  if (gameTime > bestTime) { bestTime = gameTime; localStorage.setItem('nextbot_best', bestTime.toString()); }
  // 我的信息：按模式记录最佳数据
  recordBest(gameMode, 'bestTime', gameTime);
  if (gameMode === 'survival') { recordBest('survival', 'bestWave', survival.wave); recordBest('survival', 'bestScore', survival.points); }
  const ft = document.getElementById('finalTime'); if (ft) ft.textContent = formatTime(gameTime);
  const bt = document.getElementById('bestTime'); if (bt) bt.textContent = formatTime(bestTime);
  const title = document.getElementById('gameOverTitle');
  if (reason === 'punish') title.textContent = '被罚站了！';
  else if (reason === 'dead') title.textContent = '你被打死了！';
  else title.textContent = '你被抓到了';
  // 先隐藏所有游戏HUD，再显示结算画面
  document.getElementById('hud').style.display = 'none';
  document.getElementById('distance').style.display = 'none';
  document.getElementById('healthBarContainer').style.display = 'none';
  document.getElementById('pigHealthBarContainer').style.display = 'none';
  document.getElementById('attackBtn').style.display = 'none';
  document.getElementById('hotbar').style.display = 'none';
  document.getElementById('srtStatus').style.display = 'none';
  document.getElementById('srtHealthBar').style.display = 'none';
  document.getElementById('srtOKBtn').style.display = 'none';
  document.getElementById('survivalWaveInfo').style.display = 'none';
  document.getElementById('survivalPoints').style.display = 'none';
  document.getElementById('survivalShopBtn').style.display = 'none';
  document.getElementById('survivalShop').style.display = 'none';
  document.getElementById('blackpigStatus').style.display = 'none';
  document.getElementById('punishOverlay').style.display = 'none';
  document.getElementById('dangerOverlay').style.opacity = '0';
  document.getElementById('devCheatPanel').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'flex';
  if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
  if (srtAudio && !srtAudio.paused) { srtAudio.pause(); srtAudio.currentTime = 0; }
  if (typeof stopSurvivalAudio === 'function') stopSurvivalAudio();
  bpStopAll();
  // 生存模式：清理猪
  if (gameMode === 'survival' && typeof survivalCleanup === 'function') survivalCleanup();
  // 枪战模式：清理猪/视图/HUD
  if ((gameMode === 'pigshoot' || gameMode === 'pvpgun') && typeof gunCleanup === 'function') gunCleanup();
  // 联机：通知游戏结束
  if (MP.mode !== 'offline') mpOnGameOver();
}
function returnToMenu() {
  resetAllUI();
  gameRunning = false; gamePaused = false;
  settings.gasMode = false;
  const gasToggle = document.getElementById('toggleGasMode');
  gasToggle.classList.remove('on'); gasToggle.classList.remove('disabled');
  disableGasEffect();
  if (gasAudio && !gasAudio.paused) { gasAudio.pause(); gasAudio.currentTime = 0; }
  if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
  if (typeof stopSurvivalAudio === 'function') stopSurvivalAudio();
  bpStopAll();
  if (srtAudio && !srtAudio.paused) { srtAudio.pause(); srtAudio.currentTime = 0; }
  if (typeof clearESP === 'function') clearESP();
  // 根据模式清理对应地图
  if (gameMode === 'pvp') clearEmptyArena();
  else if (gameMode === 'srt') { if (srtMapBuilt) clearSRTMap(); }
  else if (gameMode === 'survival') { clearEmptyArena(); survivalCleanup(); }
  else if (gameMode === 'hide') { if (hideMapBuilt) clearHideMap(); hide.phase = 'idle'; hideBlackoutOn = false; }
  else clearBlackpigMap();
  // SRT模式强制开启了白天，恢复为关闭
  if (gameMode === 'srt') {
    settings.dayMode = false;
    const dayToggle = document.getElementById('toggleDayMode');
    if (dayToggle) dayToggle.classList.remove('on');
    applyDayMode();
  }
  srtIsPlayerSRT = false;
  if (nextbot.mesh) nextbot.mesh.visible = true;
  if (nextbot.glowMesh) nextbot.glowMesh.visible = true;
  if (swordGroup) swordGroup.visible = false;
  swordEquipped = false; attackStage = 0;
  // 联机：返回主菜单=关闭房间/断开连接
  if (MP.mode !== 'offline') mpOnReturnMenu();
  // 重置联机UI
  document.getElementById('mpServerInfo').style.display = 'none';
  document.getElementById('mpConnectInfo').style.display = 'none';
  const mpToggle = document.getElementById('toggleMultiplayer');
  mpToggle.classList.remove('on'); mpToggle.classList.remove('disabled');
  document.getElementById('mpToggleRow').classList.remove('disabled');
  initAudio(); playMenuBgm();
  document.getElementById('settingsPanel').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  document.getElementById('pauseLabel').style.display = 'none';
  document.getElementById('modeSelectScreen').style.display = 'none';
  document.getElementById('attackBtn').style.display = 'none';
  document.getElementById('hotbar').style.display = 'none';
  document.getElementById('healthBarContainer').style.display = 'none';
  document.getElementById('pigHealthBarContainer').style.display = 'none';
  document.getElementById('blackpigStatus').style.display = 'none';
  document.getElementById('punishOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
}
function pauseGame() {
  if (!gameRunning) return;
  gamePaused = true;
  document.getElementById('pauseLabel').style.display = 'block';
  document.getElementById('settingsPanel').style.display = 'flex';
  if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
  // PC端：退出指针锁定，让鼠标能点击设置面板
  if (document.exitPointerLock) document.exitPointerLock();
  if (typeof pointerLocked !== 'undefined') pointerLocked = false;
}
function resumeGame() {
  gamePaused = false;
  document.getElementById('pauseLabel').style.display = 'none';
  document.getElementById('settingsPanel').style.display = 'none';
  // 联机主机：退出设置页 = 正式开局，广播startGame给所有客户端
  if (MP.mode === 'host' && gameRunning && !MP.gameStarted) {
    MP.gameStarted = true; MP.selectedMode = gameMode;
    Bridge.broadcast(JSON.stringify({type:"startGame", mode:gameMode}));
  }
  // 确保毒气效果开启（退出设置面板后重新应用）
  if (settings.gasMode) enableGasEffect();
}
function formatTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return(m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;}
// ==================== 血量UI ====================
function updateHealthUI() {
  const hp = Math.max(0, Math.min(100, playerHealth));
  $('healthBar').style.width = hp + '%';
  $('healthText').textContent = Math.round(hp) + '/100';
  // 多人客户端打猪模式：显示追自己的猪的血量，而不是房主的猪
  let pigHp = nextbot.health;
  if (MP.mode === 'client' && gameMode === 'hunt') {
    const myPig = [nextbot, ...(MP.extraBots||[])].find(b => b.targetId === MP.myId);
    if (myPig) pigHp = myPig.health;
  }
  const php = Math.max(0, Math.min(100, pigHp));
  $('pigHealthBar').style.width = php + '%';
  $('pigHealthText').textContent = '猪: ' + Math.round(php) + '/100';
}
// ==================== 打猪模式 - 挥刀攻击 ====================
function doAttack() {
  // 枪战模式：左键=开始开火（持续射击由gunUpdate处理，松开由mouseup停止）
  if (gameMode === 'pigshoot' || gameMode === 'pvpgun') {
    if (!gameRunning || gamePaused) return;
    if (MP.mode === 'client' && MP._clientDead) return;
    if (MP.mode === 'host' && MP._hostDead) return;
    if (playerHealth <= 0) return;
    gunStartFire();
    return;
  }
  if ((gameMode !== 'hunt' && gameMode !== 'pvp' && gameMode !== 'srt' && gameMode !== 'survival' && gameMode !== 'hide') || !gameRunning || gamePaused) return;
  if (!swordEquipped) return;
  if (attackAnimTimer > 0) return;
  // 死亡后不能攻击
  if (MP.mode === 'client' && MP._clientDead) return;
  if (MP.mode === 'host' && MP._hostDead) return;
  if (playerHealth <= 0) return;
  // SRT玩家不攻击
  if (gameMode === 'srt' && srtIsPlayerSRT) return;
  attackStage = (attackStage % 3) + 1;
  attackAnimTimer = 0.35;
  if (attackStage === 1) playSfx(sfxAttack1);
  else if (attackStage === 2) playSfx(sfxAttack2);
  else playSfx(sfxAttack3);
  // 打福瑞模式：装备了商店道具时，攻击键=使用道具（用后消耗，换回马来剑）
  if (gameMode === 'survival' && typeof equippedItem !== 'undefined' && equippedItem) {
    useSurvivalItem();
    return;
  }
  // 客户端：转发攻击给主机判定
  if (MP.mode === 'client') { clientSendAttack(attackStage); return; }
  // 主机/单机：本地判定
  if (gameMode === 'pvp') checkPlayerHit();
  else if (gameMode === 'srt') checkSRTHit();
  else if (gameMode === 'survival') { if (survivalDoAttack()) { const flash = document.getElementById('hitFlash'); if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 80); } } }
  else if (gameMode === 'hide') checkHideHit();
  else checkAllPigsHit();
}
function checkAllPigsHit() {
  const dmg = getAttackDamage(attackStage);
  const allBots = [nextbot, ...MP.extraBots];
  let hitAny = false;
  for (const bot of allBots) {
    if (!bot.alive) continue;
    const dx = bot.x - player.x, dz = bot.z - player.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > 4) continue;
    const fwd = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
    const toPig = {x: dx/dist, z: dz/dist};
    if (!devAutoAim() && fwd.x*toPig.x + fwd.z*toPig.z < 0.3) continue;
    if (pigHitCooldown > 0) continue;
    bot.health -= dmg;
    hitAny = true;
    if (typeof spawnHitParticles === 'function') spawnHitParticles(bot.x, 1.4, bot.z);
    if (bot.health <= 0) {
      bot.alive = false;
      bot.respawnTimer = 3;
      if (typeof spawnKillBurst === 'function') spawnKillBurst(bot.x, 1.4, bot.z);
      if (bot.mesh && typeof animateDeath === 'function') animateDeath(bot.mesh);
      else if (bot.mesh) bot.mesh.visible = false;
      if (bot.glowMesh) bot.glowMesh.visible = false;
      recordKill('hunt');
    }
  }
  if (hitAny) {
    pigHitCooldown = 0.3;
    const flash = document.getElementById('hitFlash');
    flash.style.opacity = '1';
    setTimeout(() => flash.style.opacity = '0', 80);
    updateHealthUI();
  }
}
function checkSRTHit() {
  if (!srt.alive) return;
  if (!srt.hasFrog) {
    if (!srt._frogHintCooldown || srt._frogHintCooldown <= 0) {
      showSRTStatus('SRT还没拿到青蛙，不能攻击！');
      srt._frogHintCooldown = 2.0;
    }
    return;
  }
  const dmg = getAttackDamage(attackStage);
  const dx = srt.x - player.x, dz = srt.z - player.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (dist > 5) return;
  if (pigHitCooldown > 0) return;
  if (typeof spawnHitParticles === 'function') spawnHitParticles(srt.x, 2, srt.z, 0xffdd44);
  srtTakeDamage(dmg);
  pigHitCooldown = 0.3;
  const flash = document.getElementById('hitFlash');
  if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 80); }
}
function checkPlayerHit() {
  const dmg = getAttackDamage(attackStage);
  const fwd = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
  let hitAny = false;
  // 检查所有其他玩家（联机主机模式）
  for (const id in MP.players) {
    const p = MP.players[id];
    if (!p || p.dead) continue;
    const dx = p.x - player.x, dz = p.z - player.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > 3.5) continue;
    const toPlayer = {x: dx/dist, z: dz/dist};
    if (!devAutoAim() && fwd.x*toPlayer.x + fwd.z*toPlayer.z < 0.4) continue;
    if (p.invincible > 0) continue;
    p.health -= dmg;
    p.invincible = 0.5;
    hitAny = true;
    if (typeof spawnHitParticles === 'function') spawnHitParticles(p.x, 1.2, p.z, 0x66aaff);
    if (p.health <= 0) {
      p.health = 0; p.dead = true; p.alive = false; p.respawnTimer = MP.RESPAWN_TIME;
      if (typeof spawnKillBurst === 'function') spawnKillBurst(p.x, 1.4, p.z);
      if (p.mesh) setPlayerDead(p.mesh, true);
      window.pvpKills = (window.pvpKills || 0) + 1;
      recordKill('pvp');
      // 广播击杀提示
      if (MP.mode === 'host' && typeof Bridge !== 'undefined') {
        Bridge.broadcast(JSON.stringify({type:'pvpKill', killer:'host', victim:p.id, killerName:MP.myName, victimName:p.name}));
      }
    }
  }
  // PVP模式：客户端也能打房主（房主自己）
  if (gameMode === 'pvp' && MP.mode === 'client' && !player.dead) {
    // 客户端打房主的情况由主机判定，这里只做本地视觉
  }
  // 主机模式下：如果攻击者是客户端，主机需要处理自己被打
  // 这个逻辑在multiplayer.js的hostOnPlayerHit里处理
  if (hitAny) {
    const flash = document.getElementById('hitFlash');
    flash.style.opacity = '1';
    setTimeout(() => flash.style.opacity = '0', 80);
  }
}
function checkPigHit() { checkAllPigsHit(); }
function toggleSword() {
  // 打福瑞模式：点马来剑槽 = 收回道具换回剑
  if (gameMode === 'survival' && gameRunning && typeof equipSurvivalSword === 'function') { equipSurvivalSword(); return; }
  if (gameMode !== 'hunt' || !gameRunning) return;
  swordEquipped = !swordEquipped;
  if (swordGroup) swordGroup.visible = swordEquipped;
  document.getElementById('slotSword').classList.toggle('active', swordEquipped);
  if (swordEquipped) {
    attackStage = 0; // 重置攻击段数
    playSfx(sfxSwordDraw);
  } else {
    attackAnimTimer = 0;
    if (swordGroup) { swordGroup.rotation.set(0,0,0); swordGroup.position.set(0,0,0); }
  }
}
// ==================== 开发者作弊UI绑定 ====================
// host和client通用：密码验证后显示devCheatRow，toggle控制作弊面板
let _devCheatBound = false;
function setupDevCheat() {
  if (_devCheatBound) return;
  _devCheatBound = true;
  const toggle = document.getElementById('devCheatToggle');
  const row = document.getElementById('devCheatRow');
  const syncDev = () => { if (typeof clientSendDevCheat === 'function') clientSendDevCheat(); };
  // toggle点击：开启/关闭作弊面板（已启用时直接切换，无需再输密码）
  function toggleDevCheat() {
    if (!devCheat.enabled) {
      // 密码未验证：弹出密码对话框
      document.getElementById('devPasswordDialog').style.display = 'flex';
      document.getElementById('devPasswordInput').value = '';
      document.getElementById('devPasswordError').style.display = 'none';
      document.getElementById('devPasswordInput').focus();
      return;
    }
    // 已启用：直接切换，不需要再输密码
    devCheat.active = !devCheat.active;
    if (toggle) toggle.classList.toggle('on', devCheat.active);
    document.getElementById('devCheatPanel').style.display = devCheat.active ? 'block' : 'none';
    syncDev();
  }
  if (toggle) toggle.addEventListener('click', toggleDevCheat);
  if (row) row.addEventListener('click', (e) => {
    if (e.target.id === 'devCheatToggle' || e.target.closest('#devCheatToggle')) return;
    toggleDevCheat();
  });
  // 作弊选项绑定
  document.getElementById('devSpeed').addEventListener('change', (e) => { devCheat.speed = e.target.checked; syncDev(); });
  document.getElementById('devSpeedMult').addEventListener('change', (e) => { devCheat.speedMult = Math.max(1, Math.min(20, parseFloat(e.target.value) || 2)); e.target.value = devCheat.speedMult; syncDev(); });
  document.getElementById('devNoCooldown').addEventListener('change', (e) => { devCheat.noCooldown = e.target.checked; });
  document.getElementById('devWallhack').addEventListener('change', (e) => { devCheat.wallhack = e.target.checked; settings.noclip = e.target.checked; });
  document.getElementById('devAutoAim').addEventListener('change', (e) => { devCheat.autoAim = e.target.checked; syncDev(); });
  document.getElementById('devInvincible').addEventListener('change', (e) => { devCheat.invincible = e.target.checked; syncDev(); });
  document.getElementById('devESP').addEventListener('change', (e) => { devCheat.esp = e.target.checked; });
  document.getElementById('devDamage').addEventListener('change', (e) => { devCheat.damage = parseInt(e.target.value) || 50; syncDev(); });
  document.getElementById('devCheatClose').addEventListener('click', () => {
    document.getElementById('devCheatPanel').style.display = 'none';
  });
}
// ==================== 菜单与关于页面 ====================
function setupMenu() {
  setupDevCheat(); // 绑定开发者作弊UI（host和client通用）
  // 第一次启动不再强制改名，使用默认名称"玩家"
  document.getElementById('aboutBtn').addEventListener('click', () => {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('aboutScreen').style.display = 'flex';
  });
  document.getElementById('aboutBackBtn').addEventListener('click', () => {
    document.getElementById('aboutScreen').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
    const gc = document.getElementById('gameCanvas'); if (gc) gc.style.display = 'none';
  });
  document.getElementById('websiteLink').addEventListener('click', (e) => {
    e.preventDefault();
    const url = 'https://xzd1314.top/';
    // 优先用系统浏览器打开；禁止在应用窗口内直接跳转（会丢失游戏页面）
    try {
      if (window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open) {
        window.__TAURI__.shell.open(url);
        return;
      }
    } catch (err) {}
    try { window.open(url, '_blank'); } catch (err) {}
  });
  // ===== 我的信息 =====
  document.getElementById('myInfoBtn').addEventListener('click', () => {
    renderMyInfo();
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('myInfoScreen').style.display = 'flex';
  });  document.getElementById('myInfoBackBtn').addEventListener('click', () => {
    document.getElementById('myInfoScreen').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
  });
  // === 开发者作弊系统：连续点击作者名5次（限定关于页，避免匹配到"我的信息"里的同名结构）===
  const authorRow = document.querySelector('#aboutScreen .about-row .value');
  if (authorRow && authorRow.textContent === 'xzd1314') {
    authorRow.style.cursor = 'pointer';
    authorRow.addEventListener('click', () => {
      devCheat.nameClickCount++;
      if (devCheat.nameClickTimer) clearTimeout(devCheat.nameClickTimer);
      devCheat.nameClickTimer = setTimeout(() => { devCheat.nameClickCount = 0; }, 2000);
      if (devCheat.nameClickCount >= 5) {
        devCheat.nameClickCount = 0;
        document.getElementById('devPasswordDialog').style.display = 'flex';
        document.getElementById('devPasswordInput').value = '';
        document.getElementById('devPasswordError').style.display = 'none';
        document.getElementById('devPasswordInput').focus();
      }
    });
  }
  // 密码确认
  document.getElementById('devPasswordConfirm').addEventListener('click', () => {
    const input = document.getElementById('devPasswordInput').value;
    if (input === devCheat.password) {
      // === 密码scrhub：开启开发者模式 ===
      devCheat.enabled = true;
      document.getElementById('devPasswordDialog').style.display = 'none';
      document.getElementById('devCheatRow').style.display = '';
      if (typeof showToast === 'function') showToast('🎮 开发者模式已启用！', 2000);
    } else if (input === '0404') {
      // === 密码0404：关闭开发者模式 ===
      devCheat.enabled = false;
      devCheat.active = false;
      devCheat.speed = false;
      devCheat.speedMult = 2;
      devCheat.noCooldown = false;
      devCheat.wallhack = false;
      devCheat.autoAim = false;
      devCheat.invincible = false;
      devCheat.esp = false;
      devCheat.damage = 50;
      settings.noclip = false;
      if (typeof clearESP === 'function') clearESP();
      document.getElementById('devPasswordDialog').style.display = 'none';
      // 重置作弊开关状态并隐藏devCheatRow
      const cheatRow = document.getElementById('devCheatRow');
      if (cheatRow) { cheatRow.style.display = 'none'; const t = cheatRow.querySelector('.toggle'); if (t) t.classList.remove('on'); }
      // 隐藏作弊面板
      document.getElementById('devCheatPanel').style.display = 'none';
      // 重置设置面板中的穿墙开关
      const noclipToggle = document.getElementById('toggleNoclip');
      if (noclipToggle) noclipToggle.classList.remove('on');
      if (typeof showToast === 'function') showToast('🚫 开发者模式已关闭', 2000);
    } else {
      document.getElementById('devPasswordError').style.display = 'block';
      document.getElementById('devPasswordInput').value = '';
    }
  });
  document.getElementById('devPasswordCancel').addEventListener('click', () => {
    document.getElementById('devPasswordDialog').style.display = 'none';
  });
  document.getElementById('devPasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('devPasswordConfirm').click();
  });
  // 开始游戏 -> 模式选择
  document.getElementById('startBtn').addEventListener('click', showPlayerSelect);
  // 单人/多人选择
  document.getElementById('singlePlayerBtn').addEventListener('click', () => {
    window._isMultiplayer = false;
    showModeSelect();
  });
  document.getElementById('multiPlayerBtn').addEventListener('click', () => {
    window._isMultiplayer = true;
    showModeSelect();
  });
  document.getElementById('playerSelectBackBtn').addEventListener('click', () => {
    document.getElementById('playerSelectScreen').style.display = 'none';
    document.getElementById('startScreen').style.display = 'flex';
  });
  // 模式选择返回 -> 回到单人/多人选择
  const modeBackBtn = document.getElementById('modeBackBtn');
  if (modeBackBtn) {
    modeBackBtn.addEventListener('click', () => {
      document.getElementById('modeSelectScreen').style.display = 'none';
      document.getElementById('playerSelectScreen').style.display = 'flex';
    });
  }
  // 模式选择卡片
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.dataset.mode === 'srt') {
        document.getElementById('modeSelectScreen').style.display = 'none';
        document.getElementById('srtSubMenu').style.display = 'flex';
        document.getElementById('srtPlayerCount').style.display = 'none';
      } else if (card.dataset.mode === 'survival') {
        document.getElementById('modeSelectScreen').style.display = 'none';
        document.getElementById('survivalSubMenu').style.display = 'flex';
        document.getElementById('survivalPlayerCount').style.display = 'none';
      } else if (card.dataset.mode === 'hide') {
        // 捉迷藏：仅多人（显式隐藏其他界面，避免主菜单透底）
        if (!window._isMultiplayer) { showToast('捉迷藏模式仅支持多人模式！'); return; }
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('playerSelectScreen').style.display = 'none';
        document.getElementById('modeSelectScreen').style.display = 'none';
        document.getElementById('hideSubMenu').style.display = 'flex';
        document.getElementById('hidePlayerCount').style.display = 'flex';
      } else if (card.dataset.mode === 'pigshoot') {
        document.getElementById('modeSelectScreen').style.display = 'none';
        document.getElementById('pigshootSubMenu').style.display = 'flex';
      } else if (card.dataset.mode === 'pvpgun') {
        document.getElementById('modeSelectScreen').style.display = 'none';
        document.getElementById('pvpgunSubMenu').style.display = 'flex';
      } else {
        startGame(card.dataset.mode);
      }
    });
  });
  // 生存模式子菜单
  document.getElementById('survivalBackBtn').addEventListener('click', () => {
    document.getElementById('survivalSubMenu').style.display = 'none';
    document.getElementById('modeSelectScreen').style.display = 'flex';
  });
  document.getElementById('survivalSingleBtn').addEventListener('click', () => {
    document.getElementById('survivalSubMenu').style.display = 'none';
    window._isMultiplayer = false;
    startGame('survival');
  });
  document.getElementById('survivalMultiBtn').addEventListener('click', () => {
    document.getElementById('survivalPlayerCount').style.display = 'flex';
  });
  document.getElementById('survivalStartMultiBtn').addEventListener('click', () => {
    document.getElementById('survivalSubMenu').style.display = 'none';
    window._pendingSurvivalMulti = true;
    window._survivalMaxPlayers = parseInt(document.querySelector('.survival-count.active')?.dataset.count) || 2;
    MP.MAX_PLAYERS = window._survivalMaxPlayers;
    MP.selectedMode = 'survival';
    window._isMultiplayer = true;
    document.getElementById('survivalMultiLobby').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('distance').style.display = 'none';
    updateSurvivalLobby();
    MP.onServerReady = (ip, port) => {
      const ipEl = document.getElementById('survivalLobbyIP');
      if (ipEl) ipEl.textContent = 'IP: ' + ip + '  端口: ' + port;
      hostBroadcastRoom();
    };
    MP.onServerError = (err) => {
      const ipEl = document.getElementById('survivalLobbyIP');
      if (ipEl) ipEl.textContent = '开启失败: ' + err;
    };
    if (typeof hostStartServer === 'function') hostStartServer();
  });
  document.getElementById('survivalCancelLobbyBtn').addEventListener('click', () => {
    if (typeof hostStopServer === 'function') hostStopServer();
    document.getElementById('survivalMultiLobby').style.display = 'none';
    document.getElementById('survivalSubMenu').style.display = 'flex';
    window._pendingSurvivalMulti = false;
  });
  document.getElementById('survivalStartGameBtn').addEventListener('click', () => {
    document.getElementById('survivalMultiLobby').style.display = 'none';
    window._isMultiplayer = true;
    if (MP.mode === 'host') {
      MP.gameStarted = true;
      MP.selectedMode = 'survival';
      for (const id in MP.players) {
        const p = MP.players[id];
        const sp = findSafeSpawn(); p.x=sp.x; p.z=sp.z;
        p.health=MP.MAX_HEALTH; p.dead=false; p.alive=true; p.respawnTimer=0; p.invincible=0;
        // 打福瑞模式：独立积分从0开始，清空道具buff（作弊状态保留，客户端会重传）
        p.points = 0;
        p.buffs = { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
      }
      hostBroadcastRoom();
    }
    startGame('survival');
  });
  // 人数选择
  document.querySelectorAll('.survival-count').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.survival-count').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  // 商店按钮
  document.getElementById('survivalShopBtn').addEventListener('click', () => {
    if (survival.waveActive) { showToast('战斗中无法打开商店！'); return; }
    openSurvivalShop();
  });
  document.getElementById('survivalShopClose').addEventListener('click', closeSurvivalShop);
  // 更新生存模式等待界面
  function updateSurvivalLobby() {
    const total = 1 + Object.keys(MP.players).length;
    const max = window._survivalMaxPlayers || 2;
    document.getElementById('survivalLobbyInfo').textContent = '等待玩家加入... (' + total + '/' + max + ')';
    const list = document.getElementById('survivalPlayerList');
    let html = '<div style="color:#44ff44;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">👑 ' + escapeHtml(MP.myName || '房主') + ' (你)</div>';
    for (const id in MP.players) {
      html += '<div style="color:#fff;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">' + escapeHtml(MP.players[id].name) + '</div>';
    }
    list.innerHTML = html;
    if (total >= 2) {
      document.getElementById('survivalStartGameBtn').style.display = 'block';
    } else {
      document.getElementById('survivalStartGameBtn').style.display = 'none';
    }
  }
  // 玩家加入时更新生存模式等待界面
  const origOnPlayerJoin2 = MP.onPlayerJoin;
  MP.onPlayerJoin = () => {
    if (origOnPlayerJoin2) origOnPlayerJoin2();
    if (window._pendingSurvivalMulti && document.getElementById('survivalMultiLobby') && document.getElementById('survivalMultiLobby').style.display === 'flex') {
      updateSurvivalLobby();
    }
  };
  const origOnPlayerLeave2 = MP.onPlayerLeave;
  MP.onPlayerLeave = () => {
    if (origOnPlayerLeave2) origOnPlayerLeave2();
    if (window._pendingSurvivalMulti && document.getElementById('survivalMultiLobby') && document.getElementById('survivalMultiLobby').style.display === 'flex') {
      updateSurvivalLobby();
    }
  };
  // SRT子菜单
  document.getElementById('srtBackBtn').addEventListener('click', () => {
    document.getElementById('srtSubMenu').style.display = 'none';
    document.getElementById('modeSelectScreen').style.display = 'flex';
  });
  document.getElementById('srtSingleBtn').addEventListener('click', () => {
    document.getElementById('srtSubMenu').style.display = 'none';
    srtIsPlayerSRT = false;
    startGame('srt');
  });
  document.getElementById('srtMultiBtn').addEventListener('click', () => {
    document.getElementById('srtPlayerCount').style.display = 'flex';
  });
  document.getElementById('srtStartMultiBtn').addEventListener('click', () => {
    document.getElementById('srtSubMenu').style.display = 'none';
    // 创建SRT专用房间
    window._pendingSrtMulti = true;
    window._srtMaxPlayers = srtSelectedCount || 2;
    MP.MAX_PLAYERS = window._srtMaxPlayers;
    MP.selectedMode = 'srt';
    window._srtSelectedSrt = null;
    // 显示等待界面
    document.getElementById('srtMultiLobby').style.display = 'flex';
    // 隐藏游戏HUD避免透出
    document.getElementById('hud').style.display = 'none';
    document.getElementById('distance').style.display = 'none';
    document.getElementById('srtStatus').style.display = 'none';
    updateSrtLobby();
    // 开启主机和广播
    MP.onServerReady = (ip, port) => {
      const ipEl = document.getElementById('srtLobbyIP');
      if (ipEl) ipEl.textContent = 'IP: ' + ip + '  端口: ' + port;
      hostBroadcastRoom();
    };
    MP.onServerError = (err) => {
      const ipEl = document.getElementById('srtLobbyIP');
      if (ipEl) ipEl.textContent = '开启失败: ' + err;
    };
    if (typeof hostStartServer === 'function') {
      hostStartServer();
    }
  });
  // SRT等待界面：取消房间
  document.getElementById('srtCancelLobbyBtn').addEventListener('click', () => {
    if (typeof hostStopServer === 'function') hostStopServer();
    document.getElementById('srtMultiLobby').style.display = 'none';
    document.getElementById('srtSubMenu').style.display = 'flex';
    window._pendingSrtMulti = false;
  });
  // SRT等待界面：开始游戏
  document.getElementById('srtStartGameBtn').addEventListener('click', () => {
    if (!window._srtSelectedSrt) { showToast('请先选择谁当 SRT！'); return; }
    document.getElementById('srtMultiLobby').style.display = 'none';
    // 主机：标记游戏开始，startGame末尾的mpOnGameStart会广播startGame和srtAssign
    if (MP.mode === 'host') {
      MP.gameStarted = true;
      MP.selectedMode = 'srt';
      // 重置所有玩家状态
      for (const id in MP.players) {
        const p = MP.players[id];
        const sp = findSafeSpawn(); p.x=sp.x; p.z=sp.z;
        p.health=MP.MAX_HEALTH; p.dead=false; p.alive=true; p.respawnTimer=0; p.invincible=0;
      }
      hostBroadcastRoom();
    }
    startGame('srt');
  });
  // 更新SRT等待界面
  function updateSrtLobby() {
    const total = 1 + Object.keys(MP.players).length;
    const max = window._srtMaxPlayers || 2;
    document.getElementById('srtLobbyInfo').textContent = '等待玩家加入... (' + total + '/' + max + ')';
    // 玩家列表
    const list = document.getElementById('srtPlayerList');
    let html = '<div style="color:#44ff44;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">👑 ' + escapeHtml(MP.myName || '房主') + ' (你)</div>';
    for (const id in MP.players) {
      html += '<div style="color:#fff;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">' + escapeHtml(MP.players[id].name) + '</div>';
    }
    list.innerHTML = html;
    // 人数够了，显示SRT选择
    if (total >= 2) {
      document.getElementById('srtSrtSelect').style.display = 'block';
      const selectList = document.getElementById('srtSrtSelectList');
      let selHtml = '<button data-srt="host" style="display:block;width:100%;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;">' + escapeHtml(MP.myName || '房主') + '</button>';
      for (const id in MP.players) {
        selHtml += '<button data-srt="' + escapeHtml(id) + '" style="display:block;width:100%;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;">' + escapeHtml(MP.players[id].name) + '</button>';
      }
      selectList.innerHTML = selHtml;
      selectList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          window._srtSelectedSrt = btn.dataset.srt;
          selectList.querySelectorAll('button').forEach(b => b.style.borderColor = '#555');
          btn.style.borderColor = '#ff4444';
          document.getElementById('srtStartGameBtn').style.display = 'block';
        });
        // 恢复之前的选中状态
        if (window._srtSelectedSrt && btn.dataset.srt === window._srtSelectedSrt) {
          btn.style.borderColor = '#ff4444';
          document.getElementById('srtStartGameBtn').style.display = 'block';
        }
      });
    } else {
      document.getElementById('srtSrtSelect').style.display = 'none';
      document.getElementById('srtStartGameBtn').style.display = 'none';
    }
  }
  // 玩家加入时更新等待界面
  const origOnPlayerJoin = MP.onPlayerJoin;
  MP.onPlayerJoin = () => {
    if (origOnPlayerJoin) origOnPlayerJoin();
    if (window._pendingSrtMulti && document.getElementById('srtMultiLobby').style.display === 'flex') {
      updateSrtLobby();
    }
  };
  // 玩家离开时更新等待界面
  const origOnPlayerLeave = MP.onPlayerLeave;
  MP.onPlayerLeave = () => {
    if (origOnPlayerLeave) origOnPlayerLeave();
    if (window._pendingSrtMulti && document.getElementById('srtMultiLobby').style.display === 'flex') {
      updateSrtLobby();
    }
  };
  // 人数选择
  document.querySelectorAll('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      srtSelectedCount = parseInt(btn.dataset.count);
    });
  });
  // 默认选中2人
  document.querySelector('.count-btn[data-count="2"]').classList.add('active');
  // SRT OK按钮（SRT玩家拿到青蛙后点击）
  document.getElementById('srtOKBtn').addEventListener('click', () => {
    document.getElementById('srtOKBtn').style.display = 'none';
    srt.state = 'running';
    if (!srtAudio) srtAudio = new Audio(AUDIO_SRT);
    srtAudio.loop = true; srtAudio.volume = 0.8; srtAudio.play().catch(()=>{});
    showSRTStatus('SRT开始逃跑！追杀它！');
    // 联机客户端SRT：通知主机（须带token，否则被主机握手校验拒绝）
    if (MP.mode === 'client') {
      Bridge.send(JSON.stringify({type:'srtReady', token:MP._handshakeToken}));
    }
  });
  // ===== 打猪枪战 子菜单 =====
  document.getElementById('pigshootBackBtn').addEventListener('click', () => {
    document.getElementById('pigshootSubMenu').style.display = 'none';
    document.getElementById('modeSelectScreen').style.display = 'flex';
  });
  document.getElementById('pigshootSingleBtn').addEventListener('click', () => {
    document.getElementById('pigshootSubMenu').style.display = 'none';
    window._isMultiplayer = false;
    startGame('pigshoot');
  });
  document.getElementById('pigshootMultiBtn').addEventListener('click', () => {
    document.getElementById('pigshootSubMenu').style.display = 'none';
    window._isMultiplayer = true;
    startGame('pigshoot');
  });
  // ===== PVP枪战 子菜单 =====
  document.getElementById('pvpgunBackBtn').addEventListener('click', () => {
    document.getElementById('pvpgunSubMenu').style.display = 'none';
    document.getElementById('modeSelectScreen').style.display = 'flex';
  });
  document.getElementById('pvpgunSingleBtn').addEventListener('click', () => {
    document.getElementById('pvpgunSubMenu').style.display = 'none';
    window._isMultiplayer = false;
    if (typeof showToast === 'function') showToast('单人练习模式（推荐多人联机对战）', 2000);
    startGame('pvpgun');
  });
  document.getElementById('pvpgunMultiBtn').addEventListener('click', () => {
    document.getElementById('pvpgunSubMenu').style.display = 'none';
    window._isMultiplayer = true;
    startGame('pvpgun');
  });
  // ===== 捉迷藏模式（多人专属） =====
  let hideSelectedCount = 2;
  document.getElementById('hideBackBtn').addEventListener('click', () => {
    document.getElementById('hideSubMenu').style.display = 'none';
    document.getElementById('modeSelectScreen').style.display = 'flex';
  });
  document.querySelectorAll('.hide-count').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hide-count').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      hideSelectedCount = parseInt(btn.dataset.count) || 2;
    });
  });
  const hideCountDefault = document.querySelector('.hide-count[data-count="2"]');
  if (hideCountDefault) hideCountDefault.classList.add('active');
  document.getElementById('hideStartMultiBtn').addEventListener('click', () => {
    document.getElementById('hideSubMenu').style.display = 'none';
    window._pendingHideMulti = true;
    window._hideMaxPlayers = hideSelectedCount || 2;
    MP.MAX_PLAYERS = window._hideMaxPlayers;
    MP.selectedMode = 'hide';
    window._hideSelectedSeeker = null;
    document.getElementById('hideMultiLobby').style.display = 'flex';
    document.getElementById('hud').style.display = 'none';
    document.getElementById('distance').style.display = 'none';
    updateHideLobby();
    MP.onServerReady = (ip, port) => {
      const ipEl = document.getElementById('hideLobbyIP');
      if (ipEl) ipEl.textContent = 'IP: ' + ip + '  端口: ' + port;
      hostBroadcastRoom();
    };
    MP.onServerError = (err) => {
      const ipEl = document.getElementById('hideLobbyIP');
      if (ipEl) ipEl.textContent = '开启失败: ' + err;
    };
    if (typeof hostStartServer === 'function') hostStartServer();
  });
  document.getElementById('hideCancelLobbyBtn').addEventListener('click', () => {
    if (typeof hostStopServer === 'function') hostStopServer();
    document.getElementById('hideMultiLobby').style.display = 'none';
    document.getElementById('hideSubMenu').style.display = 'flex';
    window._pendingHideMulti = false;
  });
  document.getElementById('hideStartGameBtn').addEventListener('click', () => {
    if (!window._hideSelectedSeeker) { showToast('请先选择谁当抓捕者！'); return; }
    document.getElementById('hideMultiLobby').style.display = 'none';
    window._isMultiplayer = true;
    if (MP.mode === 'host') {
      MP.gameStarted = true;
      MP.selectedMode = 'hide';
      for (const id in MP.players) {
        const p = MP.players[id];
        p.health = MP.MAX_HEALTH; p.dead = false; p.alive = true; p.respawnTimer = 0; p.invincible = 0;
        p.points = 0; p.buffs = { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
      }
      hostBroadcastRoom();
    }
    startGame('hide');
  });
  // 捉迷藏等待界面
  function updateHideLobby() {
    const total = 1 + Object.keys(MP.players).length;
    const max = window._hideMaxPlayers || 2;
    document.getElementById('hideLobbyInfo').textContent = '等待玩家加入... (' + total + '/' + max + ')';
    const list = document.getElementById('hidePlayerList');
    let html = '<div style="color:#44ff44;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">👑 ' + escapeHtml(MP.myName || '房主') + ' (你)</div>';
    for (const id in MP.players) {
      html += '<div style="color:#fff;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;">' + escapeHtml(MP.players[id].name) + '</div>';
    }
    list.innerHTML = html;
    // 人数够了：选择抓捕者
    if (total >= 2) {
      document.getElementById('hideSeekerSelect').style.display = 'block';
      const selectList = document.getElementById('hideSeekerSelectList');
      let selHtml = '<button data-seeker="host" style="display:block;width:100%;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;">' + escapeHtml(MP.myName || '房主') + '</button>';
      for (const id in MP.players) {
        selHtml += '<button data-seeker="' + escapeHtml(id) + '" style="display:block;width:100%;padding:8px;margin-bottom:6px;background:rgba(255,255,255,0.1);color:#fff;border:1px solid #555;border-radius:6px;cursor:pointer;">' + escapeHtml(MP.players[id].name) + '</button>';
      }
      selectList.innerHTML = selHtml;
      selectList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          window._hideSelectedSeeker = btn.dataset.seeker;
          selectList.querySelectorAll('button').forEach(b => b.style.borderColor = '#555');
          btn.style.borderColor = '#ff4444';
          document.getElementById('hideStartGameBtn').style.display = 'block';
        });
        if (window._hideSelectedSeeker && btn.dataset.seeker === window._hideSelectedSeeker) {
          btn.style.borderColor = '#ff4444';
          document.getElementById('hideStartGameBtn').style.display = 'block';
        }
      });
    } else {
      document.getElementById('hideSeekerSelect').style.display = 'none';
      document.getElementById('hideStartGameBtn').style.display = 'none';
    }
  }
  const origHideJoin = MP.onPlayerJoin;
  MP.onPlayerJoin = () => {
    if (origHideJoin) origHideJoin();
    if (window._pendingHideMulti && document.getElementById('hideMultiLobby').style.display === 'flex') updateHideLobby();
  };
  const origHideLeave = MP.onPlayerLeave;
  MP.onPlayerLeave = () => {
    if (origHideLeave) origHideLeave();
    if (window._pendingHideMulti && document.getElementById('hideMultiLobby').style.display === 'flex') updateHideLobby();
  };
  // （模式选择页的返回按钮监听在前面已注册：返回玩家选择页；此处不再重复绑定回主菜单的旧监听）
  document.getElementById('restartBtn').addEventListener('click', () => startGame(gameMode));
  document.getElementById('backToMenuBtn').addEventListener('click', returnToMenu);
  // ===== 联机模式 =====
  document.getElementById('multiplayerBtn').addEventListener('click', openMultiplayer);
  document.getElementById('mpBackBtn').addEventListener('click', closeMultiplayer);
  document.getElementById('mpInputIPBtn').addEventListener('click', () => {
    document.getElementById('ipDialog').style.display = 'flex';
    document.getElementById('ipInput').focus();
  });
  document.getElementById('ipCancelBtn').addEventListener('click', () => {
    document.getElementById('ipDialog').style.display = 'none';
  });
  document.getElementById('ipConfirmBtn').addEventListener('click', () => {
    const val = document.getElementById('ipInput').value.trim();
    if (!val) return;
    let ip = val, port = MP.roomPort;
    if (val.includes(':')) { const parts = val.split(':'); ip = parts[0]; port = parseInt(parts[1]) || MP.roomPort; }
    document.getElementById('ipDialog').style.display = 'none';
    joinRoomByIP(ip, port);
  });
  // ===== 改名称 =====
  document.getElementById('changeNameBtn').addEventListener('click', () => {
    document.getElementById('nameInput').value = MP.myName;
    document.getElementById('nameError').style.display = 'none';
    document.getElementById('nameInput').style.borderColor = '#555';
    document.getElementById('nameDialog').style.display = 'flex';
    document.getElementById('nameInput').focus();
  });
  document.getElementById('nameCancelBtn').addEventListener('click', () => {
    document.getElementById('nameDialog').style.display = 'none';
    document.getElementById('nameError').style.display = 'none';
    document.getElementById('nameInput').style.borderColor = '#555';
  });
  document.getElementById('nameConfirmBtn').addEventListener('click', () => {
    const name = document.getElementById('nameInput').value.trim();
    if (name) {
      MP.myName = name;
      localStorage.setItem('pig_player_name', name);
      document.getElementById('nameDialog').style.display = 'none';
      document.getElementById('nameError').style.display = 'none';
      document.getElementById('nameInput').style.borderColor = '#555';
    } else {
      document.getElementById('nameError').style.display = 'block';
      document.getElementById('nameInput').style.borderColor = '#ff4444';
      document.getElementById('nameInput').focus();
    }
  });
  // 回车确认改名
  document.getElementById('nameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { document.getElementById('nameConfirmBtn').click(); }
  });
  initAudio();
  // 浏览器自动播放策略：需用户首次交互后才能播放BGM
  var _bgmStarted = false;
  function _tryStartBgm() {
    if (_bgmStarted) return;
    _bgmStarted = true;
    playMenuBgm();
    document.removeEventListener('click', _tryStartBgm);
    document.removeEventListener('touchstart', _tryStartBgm);
    document.removeEventListener('keydown', _tryStartBgm);
  }
  document.addEventListener('click', _tryStartBgm);
  document.addEventListener('touchstart', _tryStartBgm);
  document.addEventListener('keydown', _tryStartBgm);
}

// ==================== 联机菜单 ====================
function openMultiplayer() {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('multiplayerScreen').style.display = 'flex';
  document.getElementById('mpRoomList').innerHTML = '<div id="mpEmptyHint">未找到房间，确保两台设备在同一局域网\n或点击右上角手动输入IP</div>';
  MP.onRoomListUpdate = renderRoomList;
  startRoomScan();
}
function closeMultiplayer() {
  stopRoomScan();
  MP.onRoomListUpdate = null;
  document.getElementById('multiplayerScreen').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
}
function renderRoomList(rooms) {
  const list = document.getElementById('mpRoomList');
  if (rooms.length === 0) {
    list.innerHTML = '<div id="mpEmptyHint">未找到房间，确保两台设备在同一局域网\n或点击右上角手动输入IP</div>';
    return;
  }
  list.innerHTML = '';
  for (const room of rooms) {
    const item = document.createElement('div');
    item.className = 'mp-room-item';
    const modeMap = {hunt:'打猪模式', blackpig:'黑猪模式', normal:'普通模式', srt:'SRT模式', pvp:'PVP对战', hide:'捉迷藏', survival:'打福瑞模式', pigshoot:'打猪枪战', pvpgun:'PVP枪战'};
    const modeName = modeMap[room.mode] || '普通模式';
    item.innerHTML = `
      <div class="mp-room-info">
        <div class="mp-room-host">${escapeHtml(room.host || '未知')}的房间</div>
        <div class="mp-room-detail">${modeName} · ${room.inGame ? '游戏中' : '等待中'} · IP: ${room.ip}:${room.port || 8765}</div>
      </div>
      <div class="mp-room-players">${room.players}/${room.maxPlayers}</div>
    `;
    item.addEventListener('click', () => joinRoomByIP(room.ip, room.port));
    list.appendChild(item);
  }
}
function escapeHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
// ==================== 我的信息 ====================
function renderMyInfo() {
  let totalPlays = 0, totalKills = 0, totalWins = 0;
  let html = '';
  for (const mode in MODE_NAMES) {
    const s = getModeStat(mode);
    totalPlays += s.plays; totalKills += s.kills; totalWins += s.wins;
    const parts = ['游玩 ' + s.plays + ' 次'];
    if (s.kills > 0) parts.push('击杀 ' + s.kills);
    if (s.wins > 0) parts.push('胜场 ' + s.wins);
    if (s.bestTime > 0) parts.push('最佳 ' + formatTime(s.bestTime));
    if (mode === 'survival') {
      if (s.bestWave > 0) parts.push('最高 ' + s.bestWave + ' 波');
      if (s.bestScore > 0) parts.push('最高分 ' + s.bestScore);
    }
    html += '<div class="info-row"><div class="info-mode">' + MODE_NAMES[mode] + '</div><div class="info-detail">' + parts.join(' · ') + '</div></div>';
  }
  const list = document.getElementById('myInfoList');
  if (list) list.innerHTML = html;
  const summary = document.getElementById('myInfoSummaryText');
  if (summary) summary.textContent = '总场次 ' + totalPlays + ' · 总击杀 ' + totalKills + ' · 总胜场 ' + totalWins;
}
function joinRoomByIP(ip, port) {
  if (!ip) { document.getElementById('mpScanIndicator').textContent = '房间IP无效'; return; }
  port = port || 8765;
  stopRoomScan();
  document.getElementById('mpScanIndicator').textContent = '正在连接 ' + ip + ':' + port + '...';
  MP.onConnected = () => {
    document.getElementById('mpScanIndicator').textContent = '已连接，正在进入游戏...';
    Bridge.send(JSON.stringify({ type: 'join', name: MP.myName }));
  };
  MP.onJoined = (msg) => {
    // 加入成功，如果游戏未开始，显示等待界面
    if (!msg.gameRunning) showClientWaitScreen();
  };
  MP.onGameStart = (mode) => {
    document.getElementById('multiplayerScreen').style.display = 'none';
    startGame(mode);
  };
  MP.onError = (msg) => {
    document.getElementById('mpScanIndicator').textContent = '连接失败: ' + msg;
    setTimeout(() => { document.getElementById('mpScanIndicator').textContent = '正在扫描局域网房间...'; }, 2000);
  };
  MP.onDisconnected = () => {
    hideClientWaitScreen();
    if (gameRunning) gameOver('caught');
    // 清理所有游戏UI残留
    document.getElementById('hud').style.display = 'none';
    document.getElementById('distance').style.display = 'none';
    document.getElementById('healthBarContainer').style.display = 'none';
    document.getElementById('pigHealthBarContainer').style.display = 'none';
    document.getElementById('attackBtn').style.display = 'none';
    document.getElementById('hotbar').style.display = 'none';
    document.getElementById('srtStatus').style.display = 'none';
    document.getElementById('srtHealthBar').style.display = 'none';
    document.getElementById('survivalWaveInfo').style.display = 'none';
    document.getElementById('survivalPoints').style.display = 'none';
    document.getElementById('survivalShopBtn').style.display = 'none';
    document.getElementById('survivalShop').style.display = 'none';
    document.getElementById('devCheatPanel').style.display = 'none';
    document.getElementById('gameOverScreen').style.display = 'none';
    document.getElementById('multiplayerScreen').style.display = 'flex';
    document.getElementById('mpScanIndicator').textContent = '与房主断开连接';
    setTimeout(() => { openMultiplayer(); }, 1500);
  };
  clientConnect(ip, port);
}
function showClientWaitScreen() {
  let el = document.getElementById('mpWaitScreen');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mpWaitScreen';
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:150;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;';
    el.innerHTML = '<div style="font-size:28px;color:#4488ff;margin-bottom:12px;">等待房主开始游戏</div><div id="mpWaitPlayers" style="font-size:15px;color:#888;"></div><div style="font-size:13px;color:#555;margin-top:20px;">玩家名: ' + escapeHtml(MP.myName) + '</div>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
  MP.onPlayerListUpdate = (list) => {
    const names = list.map(p => (p.isHost ? '[房主] ' : '') + p.name).join('、');
    document.getElementById('mpWaitPlayers').textContent = '房间玩家: ' + names;
  };
}
function hideClientWaitScreen() {
  const el = document.getElementById('mpWaitScreen');
  if (el) el.style.display = 'none';
  MP.onPlayerListUpdate = null;
}
