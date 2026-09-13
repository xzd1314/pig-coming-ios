// ==================== 更新 ====================
function update(dt) {
  if (!gameRunning || gamePaused) return;
  gameTime += dt;
  $('hud').textContent = formatTime(gameTime);
  // 冲刺
  if (sprintActive) { sprintTimer -= dt; if (sprintTimer <= 0) { sprintActive = false; cooldownTimer = devCheat.active && devCheat.noCooldown ? 0 : SPRINT_COOLDOWN; } }
  else if (cooldownTimer > 0) cooldownTimer -= dt;
  updateSprintUI();
  // 冷却
  if (pigHitCooldown > 0) pigHitCooldown -= dt;
  if (playerHitCooldown > 0) playerHitCooldown -= dt;
  if (standUpCooldown > 0) standUpCooldown -= dt;
  // 剑动画
  updateSwordAnimation(dt);
  // 粒子/击杀动画/环境特效
  if (typeof updateEffects === 'function') updateEffects(dt);
  // ESP透视更新
  if (typeof updateESP === 'function') updateESP();
  // 联机同步
  if (MP.mode !== 'offline') mpUpdate(dt);
  // 主机死亡期间禁用移动输入（保留视角转动）
  let _restoreJoy = false, _joyDx = 0, _joyDy = 0;
  if (MP.mode === 'host' && MP._hostDead) {
    _joyDx = joystick.dx; _joyDy = joystick.dy;
    joystick.dx = 0; joystick.dy = 0; _restoreJoy = true;
  }
  // 客户端模式：服务端权威——不本地移动，位置由主机state同步（带插值平滑），只做相机/渲染
  if (MP.mode === 'client') {
    // 自身位置平滑：向主机同步的目标位置插值，消除网络抖动带来的卡顿
    if (player.tx !== undefined) {
      const lf = Math.min(1, dt*15);
      player.x += (player.tx - player.x) * lf;
      player.z += (player.tz - player.z) * lf;
      // 跳跃高度：由主机权威同步，插值平滑（不再本地模拟物理，防止飞天）
      if (player.tJumpY !== undefined) player.jumpY += (player.tJumpY - player.jumpY) * lf;
    }
    // 客户端落地检测：由主机权威onGround同步（不再本地判断，防止比主机早落地导致jump请求被拒）
    // player.onGround 在 clientApplyState 中根据主机状态更新
    // 客户端SRT玩家：相机跟随主机同步的SRT位置
    if (gameMode === 'srt' && srtIsPlayerSRT) {
      // SRT位置平滑（主机30Hz同步，插值消抖）
      if (srt.targetX !== undefined) {
        const lf = Math.min(1, dt*15);
        srt.x += (srt.targetX - srt.x) * lf;
        srt.z += (srt.targetZ - srt.z) * lf;
      }
      camera.position.set(srt.x, PLAYER_H+player.jumpY, srt.z);
      camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
      if (srt.mesh) srt.mesh.visible = false;
      if (srt.hasFrog && srtFrog.mesh) {
        srtFrog.mesh.position.set(srt.x, 0.8, srt.z+1);
        srtFrog.mesh.lookAt(camera.position.x, 0.8, camera.position.z);
      }
      $('distance').textContent = srt.alive ? ('SRT血量: ' + Math.max(0,Math.round(srt.health)) + '/100') : 'SRT被击败';
      if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
      if (typeof updateSRTHealthBar === 'function') updateSRTHealthBar();
      if (srt.state === 'running') {
        const remain = Math.max(0, Math.ceil(SRT_ESCAPE_TIME - srt.escapeTimer));
        const st = $('srtStatus');
        if (st && st.dataset.remain !== String(remain)) {
          st.dataset.remain = String(remain);
          showSRTStatus('逃跑中！剩余 ' + remain + ' 秒');
        }
      }
      if (settings.gasMode) updateGasParticles(dt);
      if (settings.dayMode) updateClouds(dt);
      return;
    }
    // 远程玩家插值更新（位置由主机同步）
    for (const id in MP.remotePlayers) {
      if (typeof updateRemotePlayer === 'function') updateRemotePlayer(MP.remotePlayers[id]);
    }
    // 猪的插值更新
    if (nextbot.targetX !== undefined && nextbot.mesh) {
      const lf = Math.min(1, dt*18);
      nextbot.x += (nextbot.targetX - nextbot.x) * lf;
      nextbot.z += (nextbot.targetZ - nextbot.z) * lf;
      nextbot.mesh.position.set(nextbot.x, NEXTBOT_SIZE/2+0.15, nextbot.z);
      nextbot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
      if (nextbot.glowMesh) nextbot.glowMesh.position.copy(nextbot.mesh.position);
    }
    // 额外猪的插值
    for (const bot of (MP.extraBots || [])) {
      if (bot.targetX !== undefined && bot.mesh) {
        const lf = Math.min(1, dt*18);
        bot.x += (bot.targetX - bot.x) * lf;
        bot.z += (bot.targetZ - bot.z) * lf;
        bot.mesh.position.set(bot.x, NEXTBOT_SIZE/2+0.15, bot.z);
        bot.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
        if (bot.glowMesh) bot.glowMesh.position.copy(bot.mesh.position);
      }
    }
    // 生存模式（客户端）：同步猪的插值 + HUD
    if (gameMode === 'survival') {
      clientUpdateSurvivalPigs(dt);
      let nearestDist = Infinity;
      for (const pig of survival.pigs) {
        if (!pig.alive) continue;
        const ddx = pig.x - player.x, ddz = pig.z - player.z;
        const d = Math.sqrt(ddx*ddx + ddz*ddz);
        if (d < nearestDist) nearestDist = d;
      }
      $('distance').textContent = isFinite(nearestDist) ? ('最近福瑞: ' + nearestDist.toFixed(1) + 'm') : '等待下一波...';
      updateSurvivalAudio(nearestDist);
      updateSurvivalUI();
      if (playerHealth <= 0) $('dangerOverlay').style.opacity = '0';
    }
    // 客户端猪音效：取最近的活猪距离播放
    if (gameMode === 'hunt' || gameMode === 'normal') {
      let nearestDist = Infinity;
      if (nextbot.alive) {
        const ddx = nextbot.x - player.x, ddz = nextbot.z - player.z;
        nearestDist = Math.sqrt(ddx*ddx + ddz*ddz);
      }
      for (const bot of (MP.extraBots || [])) {
        if (!bot.alive) continue;
        const ddx = bot.x - player.x, ddz = bot.z - player.z;
        const d = Math.sqrt(ddx*ddx + ddz*ddz);
        if (d < nearestDist) nearestDist = d;
      }
      if (isFinite(nearestDist)) updateNextbotAudio(nearestDist);
    }
    if (settings.gasMode) updateGasParticles(dt);
    // PVP客户端显示击杀数
    if (gameMode === 'pvp') {
      $('distance').textContent = '击杀数: ' + (window.pvpKills || 0);
    }
    // 枪战模式客户端：更新枪械UI/换弹（猪AI与伤害由主机权威）
    if ((gameMode === 'pigshoot' || gameMode === 'pvpgun') && typeof gunUpdate === 'function') {
      gunUpdate(dt);
      $('distance').textContent = '击杀: ' + (window.pvpKills || 0);
    }
    // SRT客户端显示SRT距离
    if (gameMode === 'srt' && !srtIsPlayerSRT && srt.mesh) {
      const sdx = srt.x - player.x, sdz = srt.z - player.z;
      const srtDist = Math.sqrt(sdx*sdx + sdz*sdz);
      $('distance').textContent = srt.alive ? ('SRT距离: ' + srtDist.toFixed(1) + 'm') : 'SRT已被击败';
    }
    // 黑猪模式：客户端本地检测坐下输入（位置由主机确认同步）
    if (gameMode === 'blackpig' && !MP._clientDead) {
      const currentChair = deskChairs.find(c => c.occupiedBy === 'self');
      if (!currentChair && standUpCooldown <= 0) {
        for (const chair of deskChairs) {
          if (chair.occupiedBy) continue;
          const dx = player.x - chair.x, dz = player.z - chair.z;
          if (dx*dx + dz*dz < 0.6) {
            chair.occupiedBy = 'self'; chair.isSitting = true;
            break;
          }
        }
      }
      // 显示状态
      const isSitting = deskChairs.some(c => c.occupiedBy === 'self');
      $('distance').textContent = isSitting ? '状态: 睡觉中' : '状态: 站立';
    }
    // 捉迷藏模式（客户端）：黑屏/阶段HUD（位置由主机同步）
    if (gameMode === 'hide') {
      updateHideBlackout();
      updateHideHud();
    }
    camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
    camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
    if (settings.dayMode) updateClouds(dt);
    return;
  }
  if (gameMode === 'blackpig') {
    updateBlackpig(dt);
  } else if (gameMode === 'pvp') {
    updatePvpGame(dt);
  } else if (gameMode === 'pigshoot' || gameMode === 'pvpgun') {
    updatePigShootGame(dt);
  } else if (gameMode === 'srt') {
    updateSRTGame(dt);
  } else if (gameMode === 'survival') {
    updateSurvivalGame(dt);
  } else if (gameMode === 'hide') {
    updateHideGame(dt);
  } else {
    updateNormalGame(dt);
  }
  // 恢复摇杆输入
  if (_restoreJoy) { joystick.dx = _joyDx; joystick.dy = _joyDy; }
}

function updateSRTGame(dt) {
  // SRT玩家：相机跟随SRT，摇杆控制SRT
  if (srtIsPlayerSRT) {
    srtPlayerUpdate(dt);
    camera.position.set(srt.x, PLAYER_H+player.jumpY, srt.z);
    camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
    if (srt.mesh) srt.mesh.position.set(srt.x, 2, srt.z);
    if (srt.hasFrog && srtFrog.mesh) {
      srtFrog.mesh.position.set(srt.x, 0.8, srt.z + 1);
      srtFrog.mesh.lookAt(camera.position.x, 0.8, camera.position.z);
    }
    $('distance').textContent = srt.alive ? ('SRT血量: ' + Math.max(0,Math.round(srt.health)) + '/100') : 'SRT被击败';
    if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
    updateSRTHealthBar();
    if (settings.gasMode) updateGasParticles(dt);
    if (settings.dayMode) updateClouds(dt);
    return;
  }
  // 普通玩家移动
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  // SRT地图没有迷宫碰撞，只限制边界
  const half = SRT_FIELD_SIZE/2 - 1;
  player.x = Math.max(-half, Math.min(half, player.x + mx));
  player.z = Math.max(-half, Math.min(half, player.z + mz));
  // 跳跃
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // SRT逻辑（单机/主机）
  if (MP.mode === 'offline' || MP.mode === 'host') {
    srtUpdate(dt);
  }
  // 距离显示
  const sdx = srt.x - player.x, sdz = srt.z - player.z;
  const srtDist = Math.sqrt(sdx*sdx + sdz*sdz);
  $('distance').textContent = srt.alive ? ('SRT距离: ' + srtDist.toFixed(1) + 'm') : 'SRT已被击败';
  // 确保猪声音停止
  if (nextbotAudio && !nextbotAudio.paused) nextbotAudio.pause();
  // 更新SRT血条
  updateSRTHealthBar();
  // 毒气/白天
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
}
function updateNormalGame(dt) {
  // 玩家水平移动
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  moveWithCollision(player, mx, mz, PLAYER_RADIUS, settings.noclip);
  // 跳跃物理
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // 打猪模式：猪死重生（单机模式，联机模式由hostUpdateBots处理）
  if (gameMode === 'hunt' && MP.mode === 'offline' && !nextbot.alive) {
    if (nextbot.respawnTimer === undefined) nextbot.respawnTimer = 3;
    nextbot.respawnTimer -= dt;
    if (nextbot.respawnTimer <= 0) {
      nextbot.alive = true; nextbot.health = 100;
      const rp = findPigRespawnPoint();
      nextbot.x = rp.x; nextbot.z = rp.z;
      nextbot.respawnTimer = undefined;
      nextbot.path = []; nextbot.pathTimer = 0;
      if (nextbot.mesh) resetEntityMesh(nextbot.mesh);
      if (nextbot.glowMesh) nextbot.glowMesh.visible = true;
      // 重置猪血条UI
      if (typeof updateHealthUI === 'function') updateHealthUI();
    }
  }
  // Nextbot AI（仅普通模式和打猪模式，且猪活着）
  const nextbotSpeed = BASE_NEXTBOT_SPEED * settings.pigSpeed;
  const dx = player.x - nextbot.x, dz = player.z - nextbot.z;
  const dist = Math.sqrt(dx*dx + dz*dz);
  if (!settings.noAI && nextbot.alive) {
    nextbot.pathTimer -= dt;
    if (nextbot.pathTimer <= 0 || nextbot.path.length === 0) {
      const from = worldToGrid(nextbot.x, nextbot.z);
      const to = worldToGrid(player.x, player.z);
      nextbot.path = astar(from.r, from.c, to.r, to.c);
      nextbot.pathTimer = 0.4;
    }
    let tx, tz;
    if (nextbot.path.length > 1) {
      const np = nextbot.path[1]; const wp = gridToWorld(np.c, np.r);
      tx = wp.x; tz = wp.z;
      const dw = Math.sqrt((nextbot.x-wp.x)**2+(nextbot.z-wp.z)**2);
      if (dw < 0.8) nextbot.path.shift();
    } else {
      // 寻路失败兜底：直接朝玩家移动，避免卡在原地
      tx = player.x; tz = player.z;
    }
    const ndx = tx-nextbot.x, ndz = tz-nextbot.z;
    const nd = Math.sqrt(ndx*ndx+ndz*ndz);
    if (nd > 0.1) {
      const mvx = (ndx/nd)*nextbotSpeed*dt;
      const mvz = (ndz/nd)*nextbotSpeed*dt;
      moveWithCollision(nextbot, mvx, mvz, NEXTBOT_SIZE*0.35, false);
    }
  }
  // Billboard
  if (nextbot.alive) {
    nextbot.mesh.position.set(nextbot.x, NEXTBOT_SIZE/2+0.15, nextbot.z);
    nextbot.mesh.lookAt(player.x, NEXTBOT_SIZE/2+0.15, player.z);
    nextbot.glowMesh.position.copy(nextbot.mesh.position);
    nextbot.glowMesh.lookAt(player.x, NEXTBOT_SIZE/2+0.15, player.z);
    const glowI = 0.25 + Math.sin(performance.now()*0.005)*0.1 + (dist<6?(6-dist)/6*0.3:0);
    nextbot.glowMesh.material.opacity = glowI;
  }
  $('distance').textContent = nextbot.alive ? ('距离: ' + dist.toFixed(1) + 'm') : '猪已被击败';
  const danger = $('dangerOverlay');
  danger.style.opacity = (dist < 7 && nextbot.alive) ? (1 - dist/7).toString() : '0';
  updateNextbotAudio(dist);
  // 毒气
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
  // 碰撞判定
  if (nextbot.alive && dist < NEXTBOT_SIZE*0.55 + PLAYER_RADIUS) {
    if (gameMode === 'hunt') {
      if (MP.mode === 'host') {
        // 联机主机：扣血/复活，不结束游戏（避免房主死了全员gameOver）
        if (hostOnHostHit()) {
          danger.style.opacity = '0.8';
          setTimeout(() => { if (gameRunning) danger.style.opacity = (dist<7?(1-dist/7).toString():'0'); }, 200);
        }
      } else if (MP.mode === 'offline') {
        // 单人：扣血，血条0才游戏结束（无敌模式免伤）
        if (playerHitCooldown <= 0 && !devInvincible()) {
          playerHealth -= 15;
          playerHitCooldown = 0.8;
          updateHealthUI();
          danger.style.opacity = '0.8';
          setTimeout(() => { if (gameRunning) danger.style.opacity = (dist<7?(1-dist/7).toString():'0'); }, 200);
          if (playerHealth <= 0) { gameOver('dead'); return; }
        }
      }
    } else if (gameMode === 'normal' && MP.mode === 'offline') {
      // 单机普通模式：一击必杀游戏结束（无敌模式免疫）
      if (!devInvincible()) { gameOver('caught'); return; }
    } else if (MP.mode === 'host') {
      // 其他模式联机主机：扣血复活制
      if (hostOnHostHit()) {
        danger.style.opacity = '0.8';
        setTimeout(() => { if (gameRunning) danger.style.opacity = (dist<7?(1-dist/7).toString():'0'); }, 200);
      }
    } else {
      gameOver();
    }
  }
}
function updatePvpGame(dt) {
  // PVP模式：玩家移动，空旷场地，没有猪
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  player.x += mx; player.z += mz;
  // 边界限制（用黑猪场地大小）
  const half = 30;
  player.x = Math.max(-half, Math.min(half, player.x));
  player.z = Math.max(-half+8, Math.min(half, player.z));
  // 跳跃物理
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  $('distance').textContent = '击杀数: ' + (window.pvpKills || 0);
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
}
function updateBlackpig(dt) {
  // 黑猪模式：123木头人
  // 换面计时
  if (!blackpig.isTurning && blackpig.turnTimer > 0) {
    blackpig.turnTimer -= dt;
    if (blackpig.turnTimer <= 0) {
      blackpigTurn();
    }
  }
  // 玩家移动
  let moving = false;
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  let mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  if (Math.abs(mx) > 0.001 || Math.abs(mz) > 0.001) moving = true;
  // 黑猪看着你时，不能移动也不能坐着（无敌模式无视规则，看着也能动）
  const selfSitting = deskChairs.some(c => c.occupiedBy === 'self');
  if (blackpig.isWatching && !blackpig.isTurning && !devInvincible()) {
    if (moving || selfSitting) {
      $('punishOverlay').style.display = 'block';
      if (MP.mode === 'host') {
        // 联机：房主被罚=死亡复活，不影响其他人
        hostOnHostHit();
        setTimeout(() => { $('punishOverlay').style.display = 'none'; }, 500);
      } else if (!window._bpPunishPending) {
        // 单机：gameOver（防重复触发）
        window._bpPunishPending = true;
        setTimeout(() => { window._bpPunishPending = false; gameOver('punish'); }, 500);
      }
      return;
    }
    mx = 0; mz = 0;
  }
  // 如果坐着，不能移动
  if (deskChairs.some(c => c.occupiedBy === 'self')) { mx = 0; mz = 0; }
  player.x += mx; player.z += mz;
  // 边界限制
  const half = blackpigFieldSize/2 - 2;
  player.x = Math.max(-half, Math.min(half, player.x));
  player.z = Math.max(-half+8, Math.min(half, player.z));
  // 跳跃物理
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  // 课桌椅碰撞检测：碰到任意空椅子=坐下（起身冷却期间不检测）
  const currentChair = deskChairs.find(c => c.occupiedBy === 'self');
  if (!currentChair && standUpCooldown <= 0) {
    for (const chair of deskChairs) {
      if (chair.occupiedBy) continue;
      const ddx = player.x - chair.x, ddz = player.z - chair.z;
      const ddist = Math.sqrt(ddx*ddx + ddz*ddz);
      if (ddist < 1.0) {
        chair.occupiedBy = 'self'; chair.isSitting = true;
        player.x = chair.x; player.z = chair.z + 1.2;
        deskChair = chair; // 兼容旧代码
        break;
      }
    }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY + (deskChairs.some(c => c.occupiedBy === 'self') ? -0.5 : 0), player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // 黑猪、讲台、课桌椅billboard（始终面向玩家）
  if (blackpig.mesh) {
    blackpig.mesh.lookAt(player.x, blackpig.mesh.position.y, player.z);
  }
  if (blackpig.podiumMesh) {
    blackpig.podiumMesh.lookAt(player.x, blackpig.podiumMesh.position.y, player.z);
  }
  for (const chair of deskChairs) {
    if (chair.mesh) chair.mesh.lookAt(player.x, chair.mesh.position.y, player.z);
  }
  const isSitting = deskChairs.some(c => c.occupiedBy === 'self');
  $('distance').textContent = isSitting ? '状态: 睡觉中' : '状态: 站立';
}
function updateSprintUI() {
  const btn = $('sprintBtn');
  if (!btn) return;
  const label = sprintActive ? '冲刺中' : (cooldownTimer > 0 ? cooldownTimer.toFixed(1)+'s' : '冲刺');
  if (btn.textContent !== label) btn.textContent = label;
  btn.classList.toggle('cooldown', !sprintActive && cooldownTimer > 0);
}
function doJump() {
  if (!gameRunning || gamePaused) return;
  // 死亡时不能跳跃
  if (MP.mode === 'client' && MP._clientDead) return;
  if (MP.mode === 'host' && MP._hostDead) return;
  if (playerHealth <= 0) return;
  // 黑猪模式：坐着时跳=下来
  if (gameMode === 'blackpig') {
    const sittingChair = deskChairs.find(c => c.occupiedBy === 'self');
    if (sittingChair) {
      sittingChair.occupiedBy = null; sittingChair.isSitting = false;
      deskChair = deskChairs[0];
      standUpCooldown = 1.0;
    }
  }
  if (player.onGround) {
    player.vy = JUMP_FORCE;
    // 客户端模式：onGround由主机权威同步（jumpY回0广播会复位onGround），
    // 本地翻转会与主机同步竞争，导致clientSendInput的跳跃请求被限频吞掉（跳不起来）。
    // 客户端跳跃意图通过 KEYS['Space'] 原始状态上报主机，无需本地翻转。
    if (MP.mode !== 'client') player.onGround = false;
  }
}
// ==================== 白天/黑天切换 ====================
function applyDayMode() {
  if (settings.dayMode) {
    scene.background = new THREE.Color(0x87ceeb); scene.fog = new THREE.Fog(0x87ceeb, 25, 70);
    ambientLight.color.setHex(0xffffff); ambientLight.intensity = 0.95;
    dirLight.color.setHex(0xffffee); dirLight.intensity = 0.85;
    flashlight.intensity = 0.15;
    if (ceilingMesh) ceilingMesh.visible = false;
    showSkyElements(true);
  } else {
    scene.background = new THREE.Color(0x15152a); scene.fog = new THREE.Fog(0x15152a, 6, 30);
    ambientLight.color.setHex(0x7777aa); ambientLight.intensity = 0.55;
    dirLight.color.setHex(0xffffff); dirLight.intensity = 0.4;
    flashlight.intensity = 0.9;
    if (ceilingMesh) ceilingMesh.visible = true;
    showSkyElements(false);
  }
}
function updateSurvivalGame(dt) {
  // 生存模式：玩家移动
  const speedMult = survivalGetSpeedMultiplier();
  const speed = (sprintActive ? SPRINT_SPEED : PLAYER_SPEED) * speedMult * devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  // 空旷场地，无碰撞，只限边界
  const half = SURVIVAL.FIELD_SIZE/2 - 2;
  player.x = Math.max(-half, Math.min(half, player.x + mx));
  player.z = Math.max(-half, Math.min(half, player.z + mz));
  // 跳跃物理
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // 生存模式逻辑
  if (MP.mode === 'offline' || MP.mode === 'host') {
    survivalUpdate(dt);
  }
  // 距离显示最近福瑞
  let nearestDist = Infinity;
  for (const pig of survival.pigs) {
    if (!pig.alive) continue;
    const ddx = pig.x - player.x, ddz = pig.z - player.z;
    const d = Math.sqrt(ddx*ddx + ddz*ddz);
    if (d < nearestDist) nearestDist = d;
  }
  $('distance').textContent = isFinite(nearestDist) ? ('最近福瑞: ' + nearestDist.toFixed(1) + 'm') : '等待下一波...';
  updateSurvivalAudio(nearestDist);
  // 无敌视觉提示
  if (survival.invincible) {
    $('dangerOverlay').style.opacity = '0';
  }
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
}

// ==================== 枪战模式（打猪枪战 / PVP枪战） ====================
function updatePigShootGame(dt) {
  // 玩家移动（空旷场地，边界限制）
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  const half = 28;
  player.x = Math.max(-half, Math.min(half, player.x + mx));
  player.z = Math.max(-half, Math.min(half, player.z + mz));
  // 跳跃物理
  if (!player.onGround) {
    player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
    if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // 枪战核心逻辑（射击/换弹/后坐力/猪AI）
  if (typeof gunUpdate === 'function') gunUpdate(dt);
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
}
function updateHideGame(dt) {
  // 全员可移动（躲藏者逃跑、抓捕者巡逻），使用捉迷藏地图碰撞
  let speed = sprintActive ? SPRINT_SPEED : PLAYER_SPEED;
  speed *= devSpeedMult();
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const mx = (-sy*joystick.dy + cy*joystick.dx)*speed*dt;
  const mz = (-cy*joystick.dy - sy*joystick.dx)*speed*dt;
  if (typeof moveWithHideCollision === 'function') moveWithHideCollision(player, mx, mz, PLAYER_RADIUS);
  else { player.x += mx; player.z += mz; }
  const half = HIDE_FIELD/2 - 2;
  player.x = Math.max(-half, Math.min(half, player.x));
  player.z = Math.max(-half, Math.min(half, player.z));
  // 跳跃物理
  // 客户端：onGround在clientApplyState中由主机状态同步，不做本地落地检测
  // 主机/单机：本地跑物理
  if (MP.mode !== 'client') {
    if (!player.onGround) {
      player.vy += GRAVITY*dt; player.jumpY += player.vy*dt;
      if (player.jumpY <= 0) { player.jumpY = 0; player.vy = 0; player.onGround = true; }
    }
  }
  camera.position.set(player.x, PLAYER_H+player.jumpY, player.z);
  camera.rotation.order = 'YXZ'; camera.rotation.y = player.yaw; camera.rotation.x = player.pitch;
  // 阶段推进（主机权威）+ 黑屏/HUD
  hideUpdate(dt);
  updateHideBlackout();
  updateHideHud();
  if (settings.gasMode) updateGasParticles(dt);
  if (settings.dayMode) updateClouds(dt);
}
