// ============================================================
// 猪来了NextBot - 打福瑞模式（原生存模式）
// 波次递增，福瑞越来越快，波间有商店
// ============================================================

const SURVIVAL = {
  FIELD_SIZE: 60,
  WAVE_BASE_PIGS: 2,
  WAVE_SPEED_MULT: 0.12,
  POINTS_PER_KILL: 50,
  WAVE_BONUS: 100,
  WAVE_DELAY: 5,
  // 商店物品（购买后作为道具放入物品栏，使用时消耗）
  SHOP_ITEMS: [
    { id: 'speed', name: '加速', desc: '使用后移动速度+30%，持续30秒', icon: '⚡', price: 100 },
    { id: 'invincible', name: '无敌', desc: '使用后10秒内免疫伤害', icon: '🛡️', price: 200 },
    { id: 'bomb', name: '炸弹', desc: '使用后消灭场上所有福瑞', icon: '💣', price: 150 },
    { id: 'heal', name: '回血', desc: '使用后恢复25点生命值', icon: '❤️', price: 80 },
    { id: 'damage', name: '强化', desc: '使用后攻击伤害+15，持续30秒', icon: '⚔️', price: 250 },
  ],
  // 装备道具时攻击键显示的文字
  ITEM_LABELS: {
    speed: '⚡疾跑', invincible: '🛡️格挡', bomb: '💣引爆', heal: '❤️急救', damage: '⚔️重击',
  },
};

// ===== 物品栏（商店道具，点击装备，攻击键使用后消耗）=====
let survivalInventory = [];   // [{id, icon, name}]
let equippedItem = null;      // 当前装备的道具（null=马来剑）
// 共享的猪视觉资源（所有生存猪复用同一纹理/几何体/材质，避免每头猪新建GPU纹理）
let _survivalPigRes = null;
function getSurvivalPigResources() {
  if (_survivalPigRes) return _survivalPigRes;
  // 生存模式专属贴图（survival_entity.jpg，普通模式/打猪模式仍用NEXTBOT_TEX_DATA）
  const tex = new THREE.TextureLoader().load(SURVIVAL_ENTITY_TEX_DATA, function(t){t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;}, undefined, function(err){ console.error('Survival texture FAILED:', err); });
  const mat = new THREE.MeshBasicMaterial({map:tex,transparent:true,alphaTest:0.1,side:THREE.DoubleSide});
  const geo = new THREE.PlaneGeometry(NEXTBOT_SIZE, NEXTBOT_SIZE);
  const glowGeo = new THREE.PlaneGeometry(NEXTBOT_SIZE+0.5, NEXTBOT_SIZE+0.5);
  const glowMat = new THREE.MeshBasicMaterial({color:0xff2222,transparent:true,opacity:0.35,side:THREE.BackSide});
  _survivalPigRes = { mat, geo, glowGeo, glowMat };
  return _survivalPigRes;
}

function drawSurvivalPigHP(sprite, hp) {
  if (!sprite || !sprite.userData.canvas) return;
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 24);
  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(4, 4, 120, 16);
  // 血条
  const pct = Math.max(0, Math.min(100, hp)) / 100;
  ctx.fillStyle = pct > 0.5 ? '#44ff44' : pct > 0.25 ? '#ffaa00' : '#ff4444';
  ctx.fillRect(4, 4, 120 * pct, 16);
  // 边框
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 4, 120, 16);
  // 数字
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(hp) + '/100', 64, 16);
  sprite.userData.tex.needsUpdate = true;
}
function survivalInit() {
  // 清除旧猪的mesh
  for (const pig of survival.pigs) {
    if (pig.mesh) { scene.remove(pig.mesh); pig.mesh = null; }
    if (pig.glowMesh) { scene.remove(pig.glowMesh); pig.glowMesh = null; }
  }
  survival.wave = 0;
  survival.pigs = [];
  survival.points = 0;
  survival.totalKills = 0;
  survival.waveActive = false;
  survival.wavePigsRemaining = 0;
  survival.shopOpen = false;
  survival.waveDelay = SURVIVAL.WAVE_DELAY;
  survival.pigSpeedMultiplier = 1;
  survival.damageMultiplier = 1;
  survival.speedBoost = false;
  survival.speedBoostTimer = 0;
  survival.invincible = false;
  survival.invincibleTimer = 0;
  survival.swordDamageBonus = 0;
  survival.swordDamageTimer = 0;
  survival.maxHp = 100;
  // 重置物品栏与装备
  survivalInventory = [];
  equippedItem = null;
  if (typeof hideItemViewmodel === 'function') hideItemViewmodel();
  renderSurvivalHotbar();
  setAttackBtnLabel('挥刀');
  playerHealth = 100;
  // 显示UI
  showSurvivalUI(true);
  // 开始第一波倒计时
  survival.waveDelay = 3;
}

function survivalCleanup() {
  // 清除所有生存模式猪
  for (const pig of survival.pigs) {
    if (pig.mesh) { scene.remove(pig.mesh); pig.mesh = null; }
    if (pig.glowMesh) { scene.remove(pig.glowMesh); pig.glowMesh = null; }
  }
  survival.pigs = [];
  showSurvivalUI(false);
}

function showSurvivalUI(show) {
  const ids = ['survivalWaveInfo', 'survivalPoints', 'survivalShopBtn'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  }
  if (!show) {
    const shop = document.getElementById('survivalShop');
    if (shop) shop.style.display = 'none';
    survival.shopOpen = false;
  }
}

function updateSurvivalUI() {
  const waveEl = $('survivalWaveInfo');
  const ptsEl = $('survivalPoints');
  const shopBtn = $('survivalShopBtn');
  if (waveEl) {
    if (survival.waveActive) {
      waveEl.textContent = '第 ' + survival.wave + ' 波  |  剩余: ' + survival.wavePigsRemaining + '只福瑞';
    } else if (survival.waveDelay > 0) {
      waveEl.textContent = '第 ' + (survival.wave + 1) + ' 波即将开始... ' + Math.ceil(survival.waveDelay) + 's';
    }
  }
  if (ptsEl) ptsEl.textContent = '积分: ' + survival.points + '  |  击杀: ' + survival.totalKills;
  // 商店按钮：所有人可用（联机时每个玩家扣自己的独立积分）
  if (shopBtn) {
    const canShop = survival.wave > 0 && !survival.waveActive;
    shopBtn.textContent = '商店 (' + survival.points + '积分)';
    shopBtn.style.display = canShop ? 'block' : 'none';
  }
}

// 创建猪的视觉体（主机生成与客户端同步共用）
function createSurvivalPigVisual() {
  const res = getSurvivalPigResources();
  const mesh = new THREE.Mesh(res.geo, res.mat);
  const glowMesh = new THREE.Mesh(res.glowGeo, res.glowMat);

  // 血条Sprite
  const hpCanvas = document.createElement('canvas'); hpCanvas.width = 128; hpCanvas.height = 24;
  const hpTex = new THREE.CanvasTexture(hpCanvas); hpTex.needsUpdate = true;
  const hpMat = new THREE.SpriteMaterial({map:hpTex, transparent:true, depthTest:false});
  const hpSprite = new THREE.Sprite(hpMat); hpSprite.scale.set(2.0, 0.35, 1);
  hpSprite.position.y = NEXTBOT_SIZE + 0.5;
  mesh.add(hpSprite);
  hpSprite.userData = {canvas:hpCanvas, tex:hpTex};
  drawSurvivalPigHP(hpSprite, 100);

  return { mesh, glowMesh, hpSprite };
}

function survivalSpawnPig() {
  const visual = createSurvivalPigVisual();
  const mesh = visual.mesh, glowMesh = visual.glowMesh, hpSprite = visual.hpSprite;

  // 随机边缘位置
  const half = SURVIVAL.FIELD_SIZE / 2 - 4;
  const side = Math.floor(Math.random() * 4);
  let x, z;
  switch(side) {
    case 0: x = (Math.random()-0.5)*half*2; z = -half; break;
    case 1: x = (Math.random()-0.5)*half*2; z = half; break;
    case 2: x = -half; z = (Math.random()-0.5)*half*2; break;
    case 3: x = half; z = (Math.random()-0.5)*half*2; break;
  }

  mesh.position.set(x, NEXTBOT_SIZE/2+0.15, z);
  glowMesh.position.copy(mesh.position);
  scene.add(mesh);
  scene.add(glowMesh);

  const speed = (BASE_NEXTBOT_SPEED * survival.pigSpeedMultiplier) * (1 + (survival.wave - 1) * SURVIVAL.WAVE_SPEED_MULT);
  return {
    x, z, mesh, glowMesh, hpSprite,
    health: 100,
    alive: true,
    respawnTimer: 0,
    counted: false, // 波次进度只计第一次击杀，防止重生猪被重复扣减剩余数
    speed: Math.min(speed, 12),
    path: [],
    pathTimer: 0,
  };
}

const SURVIVAL_MAX_WAVE = 100;

// 分配福瑞追踪目标：每个猪分配一个玩家目标
function assignPigTargets() {
  // 收集所有存活玩家ID
  const alivePlayers = [];
  if (!MP._hostDead) alivePlayers.push({id:'host', x:player.x, z:player.z});
  for (const id in MP.players) {
    const p = MP.players[id];
    if (!p.dead) alivePlayers.push({id, x:p.x, z:p.z});
  }
  if (alivePlayers.length === 0) return;
  // 分配策略：每只猪分配一个目标，尽量均匀分布
  survival.pigs.forEach((pig, i) => {
    pig.targetId = alivePlayers[i % alivePlayers.length].id;
  });
}

// 获取追踪目标的位置
function getSurvivalTargetPos(targetId) {
  if (!targetId || targetId === 'host') return {x: player.x, z: player.z};
  const p = MP.players[targetId];
  if (p && !p.dead) return {x: p.x, z: p.z};
  // 目标已死：随机切换到一个存活玩家（不要全涌向房主，否则房主会被孤儿猪堆死）
  const alive = [];
  if (!MP._hostDead) alive.push({x: player.x, z: player.z});
  for (const id in MP.players) {
    const pp = MP.players[id];
    if (pp && !pp.dead) alive.push({x: pp.x, z: pp.z});
  }
  if (alive.length) return alive[Math.floor(Math.random() * alive.length)];
  return {x: player.x, z: player.z};
}

function startSurvivalWave() {
  // 波次上限检查
  if (survival.wave >= SURVIVAL_MAX_WAVE) {
    survival.waveActive = false;
    if (typeof showToast === 'function') showToast('🎉 恭喜通关！你通过了全部 ' + SURVIVAL_MAX_WAVE + ' 波！', 5000);
    setTimeout(() => { gameOver('survival_complete'); }, 3000);
    return;
  }
  survival.wave++;
  survival.waveActive = true;
  survival.shopOpen = false;
  const pigCount = SURVIVAL.WAVE_BASE_PIGS + Math.floor(survival.wave * 1.5);
  survival.wavePigsRemaining = pigCount;
  survival.pigSpeedMultiplier = 1 + (survival.wave - 1) * 0.15;
  // 清除旧猪
  for (const pig of survival.pigs) {
    if (pig.mesh) scene.remove(pig.mesh);
    if (pig.glowMesh) scene.remove(pig.glowMesh);
  }
  survival.pigs = [];
  // 生成新猪
  for (let i = 0; i < pigCount; i++) {
    survival.pigs.push(survivalSpawnPig());
  }
  // 分配追踪目标：每个猪分配一个目标玩家
  assignPigTargets();
  // 显示波次提示
  if (typeof showToast === 'function') showToast('第 ' + survival.wave + ' 波！' + pigCount + '只福瑞来袭！', 2000);
  updateSurvivalUI();
}

function survivalPigKilled(pig, killerId) {
  pig.alive = false;
  if (typeof spawnKillBurst === 'function') spawnKillBurst(pig.x, 1.4, pig.z);
  if (pig.mesh && typeof animateDeath === 'function') animateDeath(pig.mesh);
  else if (pig.mesh) pig.mesh.visible = false;
  if (pig.glowMesh) pig.glowMesh.visible = false;
  pig.respawnTimer = 2;
  survival.totalKills++;
  // 我的信息：主机/单机自己的击杀数（联机客户端击杀由主机判定，不计入）
  if (!killerId || killerId === 'host') recordKill('survival');
  // 积分记入击杀者（联机每个玩家积分独立）
  if (killerId && MP.players[killerId]) {
    MP.players[killerId].points = (MP.players[killerId].points || 0) + SURVIVAL.POINTS_PER_KILL;
  } else {
    survival.points += SURVIVAL.POINTS_PER_KILL;
  }
  // 波次剩余数只对每头福瑞第一次击杀递减（重生后再被击杀不重复扣，否则波次会提前结束）
  if (!pig.counted) {
    pig.counted = true;
    survival.wavePigsRemaining--;
  }
  updateSurvivalUI();
  // 检查波次是否结束
  if (survival.wavePigsRemaining <= 0) {
    survival.waveActive = false;
    const bonus = SURVIVAL.WAVE_BONUS * survival.wave;
    // 波次奖励：所有玩家（含联机客户端）都获得
    survival.points += bonus;
    for (const id in MP.players) {
      MP.players[id].points = (MP.players[id].points || 0) + bonus;
    }
    survival.waveDelay = SURVIVAL.WAVE_DELAY;
    if (typeof showToast === 'function') showToast('第 ' + survival.wave + ' 波完成！所有人+' + bonus + '积分', 2000);
    updateSurvivalUI();
  }
}

function survivalUpdate(dt) {
  if (!gameRunning || gameMode !== 'survival') return;

  // 更新效果计时器
  if (survival.speedBoost) {
    survival.speedBoostTimer -= dt;
    if (survival.speedBoostTimer <= 0) { survival.speedBoost = false; }
  }
  if (survival.invincible) {
    survival.invincibleTimer -= dt;
    if (survival.invincibleTimer <= 0) { survival.invincible = false; }
  }
  if (survival.swordDamageBonus > 0) {
    survival.swordDamageTimer -= dt;
    if (survival.swordDamageTimer <= 0) { survival.swordDamageBonus = 0; }
  }

  // 波次间延迟（商店打开时暂停倒计时，避免逛商店时下一波开打）
  if (!survival.waveActive && !survival.shopOpen && survival.waveDelay > 0) {
    survival.waveDelay -= dt;
    if (survival.waveDelay <= 0) {
      startSurvivalWave();
    }
    updateSurvivalUI();
    return;
  }    if (!survival.waveActive) return;

  // 波次上限显示
  if (survival.wave >= SURVIVAL_MAX_WAVE && !survival.waveActive) return;

  // 更新猪的AI和移动
  for (const pig of survival.pigs) {
    if (!pig.alive) {
      pig.respawnTimer -= dt;
      if (pig.respawnTimer <= 0) {
        // 重生
        pig.alive = true;
        pig.health = 100;
        const half = SURVIVAL.FIELD_SIZE / 2 - 4;
        const side = Math.floor(Math.random() * 4);
        switch(side) {
          case 0: pig.x = (Math.random()-0.5)*half*2; pig.z = -half; break;
          case 1: pig.x = (Math.random()-0.5)*half*2; pig.z = half; break;
          case 2: pig.x = -half; pig.z = (Math.random()-0.5)*half*2; break;
          case 3: pig.x = half; pig.z = (Math.random()-0.5)*half*2; break;
        }
        pig.path = [];
        pig.pathTimer = 0;
        // 重生时重新分配目标
        assignPigTargets();
        if (pig.mesh) resetEntityMesh(pig.mesh);
        if (pig.glowMesh) pig.glowMesh.visible = true;
      }
      continue;
    }

    // A*寻路：追踪分配的目标玩家
    pig.pathTimer -= dt;
    const tgt = getSurvivalTargetPos(pig.targetId);
    if (pig.pathTimer <= 0 || pig.path.length === 0) {
      const from = worldToGrid(pig.x, pig.z);
      const to = worldToGrid(tgt.x, tgt.z);
      pig.path = astar(from.r, from.c, to.r, to.c);
      pig.pathTimer = 0.5;
    }

    // 移动
    let tx, tz;
    if (pig.path.length > 1) {
      const np = pig.path[1];
      const wp = gridToWorld(np.c, np.r);
      tx = wp.x; tz = wp.z;
      if (Math.sqrt((pig.x-wp.x)**2+(pig.z-wp.z)**2) < 0.8) pig.path.shift();
    } else {
      tx = tgt.x; tz = tgt.z;
    }

    const dx = tx - pig.x, dz = tz - pig.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > 0.1) {
      const mvx = (dx/dist) * pig.speed * dt;
      const mvz = (dz/dist) * pig.speed * dt;
      pig.x += mvx;
      pig.z += mvz;
      // 边界限制
      const half = SURVIVAL.FIELD_SIZE / 2 - 2;
      pig.x = Math.max(-half, Math.min(half, pig.x));
      pig.z = Math.max(-half, Math.min(half, pig.z));
    }

    // 更新mesh
    if (pig.mesh) {
      pig.mesh.position.set(pig.x, NEXTBOT_SIZE/2+0.15, pig.z);
      pig.mesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    }
    if (pig.glowMesh) {
      pig.glowMesh.position.copy(pig.mesh.position);
      pig.glowMesh.lookAt(camera.position.x, NEXTBOT_SIZE/2+0.15, camera.position.z);
    }

    // 碰撞检测：福瑞碰到追踪目标或附近的玩家
    const hitRadius = NEXTBOT_SIZE * 0.55 + PLAYER_RADIUS;
    // 检查所有玩家（包括房主和联机玩家），最近的被攻击
    // 修复：房主已死亡时不再把尸体当目标——否则猪会反复命中尸体，
    //   每次命中都重置 MP._hostRespawnTimer，房主永远无法复活（表现为服务端卡死/闪退）。
    const allTargets = [];
    if (!MP._hostDead) allTargets.push({id:'host', x:player.x, z:player.z, isHost:true});
    if (MP.mode === 'host') {
      for (const id in MP.players) {
        const rp = MP.players[id];
        if (rp.dead) continue;
        allTargets.push({id, x:rp.x, z:rp.z, isHost:false, obj:rp});
      }
    }
    for (const t of allTargets) {
      const pdx = pig.x - t.x, pdz = pig.z - t.z;
      const pdist = Math.sqrt(pdx*pdx + pdz*pdz);
      if (pdist >= hitRadius || !pig.alive) continue;
      if (t.isHost) {
        // 房主被攻击（防御性：再校验一次未死亡，防止尸体被反复命中重置重生计时）
        if (!MP._hostDead && !survival.invincible && !devInvincible() && playerHitCooldown <= 0) {
          playerHealth -= 20;
          playerHitCooldown = 0.8;
          updateHealthUI();
          const flash = document.getElementById('hitFlash');
          if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 100); }
          if (playerHealth <= 0) {
            playerHealth = 0;
            // 联机：房主死亡不结束游戏，改为个人死亡+复活（打福瑞重生3秒）
            if (MP.mode === 'host') {
              MP._hostDead = true; MP._hostHealth = 0;
              MP._hostRespawnTimer = (typeof MP.getRespawnTime === 'function') ? MP.getRespawnTime() : MP.RESPAWN_TIME;
              if (typeof showHostDeath === 'function') showHostDeath();
            } else {
              gameOver('dead');
              return;
            }
          }
        }
      } else if (t.obj) {
        // 联机远程玩家被攻击
        const rp = t.obj;
        if (rp.invincible > 0) continue;
        if (rp.buffs && rp.buffs.invincibleUntil > gameTime) continue;
        if (rp.dev && rp.dev.invincible) continue;
        rp.health -= 20; rp.invincible = 0.8;
        if (rp.health <= 0) {
          rp.health = 0; rp.dead = true; rp.alive = false;
          rp.respawnTimer = (typeof MP.getRespawnTime === 'function') ? MP.getRespawnTime() : MP.RESPAWN_TIME;
          if (rp.mesh) setPlayerDead(rp.mesh, true);
        }
      }
    }
  }

  updateSurvivalUI();
}

function survivalDoAttack() {
  // 攻击判定：检查所有存活的福瑞（伤害走统一作弊计算，含强化加成）
  const dmg = getAttackDamage(attackStage, survival.swordDamageBonus);
  const allPigs = survival.pigs.filter(p => p.alive);
  let hitAny = false;

  for (const pig of allPigs) {
    const dx = pig.x - player.x, dz = pig.z - player.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > 5.5) continue;
    const fwd = {x: -Math.sin(player.yaw), z: -Math.cos(player.yaw)};
    const toPig = {x: dx/dist, z: dz/dist};
    if (!devAutoAim() && fwd.x*toPig.x + fwd.z*toPig.z < 0.15) continue;
    pig.health -= dmg;
    hitAny = true;
    // 更新血条
    if (pig.hpSprite) drawSurvivalPigHP(pig.hpSprite, pig.health);
    if (pig.health <= 0) {
      survivalPigKilled(pig);
    }
  }
  return hitAny;
}

// 商店系统
function openSurvivalShop() {
  survival.shopOpen = true;
  survival.waveActive = false;
  const shop = document.getElementById('survivalShop');
  if (!shop) return;
  shop.style.display = 'flex';
  renderSurvivalShop();
}

function closeSurvivalShop() {
  survival.shopOpen = false;
  const shop = document.getElementById('survivalShop');
  if (shop) shop.style.display = 'none';
}

function renderSurvivalShop() {
  const container = document.getElementById('survivalShopItems');
  const ptsEl = document.getElementById('survivalShopPoints');
  if (!container) return;
  if (ptsEl) ptsEl.textContent = '积分: ' + survival.points;
  container.innerHTML = '';
  for (const item of SURVIVAL.SHOP_ITEMS) {
    const canBuy = survival.points >= item.price;
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = '<div class="item-icon">' + item.icon + '</div>' +
      '<div class="item-info"><div class="item-name">' + item.name + '</div>' +
      '<div class="item-desc">' + item.desc + '</div></div>' +
      '<div class="item-price">' + item.price + '积分</div>';
    if (canBuy) {
      div.addEventListener('click', () => buySurvivalItem(item));
    }
    container.appendChild(div);
  }
}

// 购买：道具放入物品栏（不立即生效），联机时扣除的是自己的独立积分
function buySurvivalItem(item) {
  if (survival.points < item.price) return;
  survival.points -= item.price;
  // 联机客户端：通知主机扣减主机侧积分（主机校验，积分经state同步修正）
  if (MP.mode === 'client') {
    Bridge.send(JSON.stringify({type:'shopBuy', token:MP._handshakeToken, itemId:item.id}));
  }
  grantSurvivalItem(item);
  renderSurvivalShop();
}

function grantSurvivalItem(item) {
  const inv = { id: item.id, icon: item.icon, name: item.name };
  survivalInventory.push(inv);
  renderSurvivalHotbar();
  if (typeof showToast === 'function') showToast(item.icon + ' ' + item.name + ' 已放入物品栏，点击图标装备后按攻击键使用', 2400);
}

// ===== 物品栏渲染与装备 =====
function renderSurvivalHotbar() {
  const hotbar = document.getElementById('hotbar');
  if (!hotbar) return;
  // 移除旧道具槽（保留马来剑槽）
  hotbar.querySelectorAll('.survival-item-slot').forEach(el => el.remove());
  survivalInventory.forEach((inv, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot emoji-slot survival-item-slot' + (equippedItem === inv ? ' active' : '');
    slot.textContent = inv.icon;
    slot.addEventListener('click', () => equipSurvivalItem(i));
    hotbar.appendChild(slot);
  });
  const swordSlot = document.getElementById('slotSword');
  if (swordSlot && gameMode === 'survival') swordSlot.classList.toggle('active', !equippedItem);
}

function equipSurvivalItem(i) {
  const inv = survivalInventory[i];
  if (!inv) return;
  equippedItem = inv;
  if (typeof swordGroup !== 'undefined' && swordGroup) swordGroup.visible = false;
  if (typeof showItemViewmodel === 'function') showItemViewmodel(inv.icon);
  setAttackBtnLabel(SURVIVAL.ITEM_LABELS[inv.id] || (inv.icon + '使用'));
  renderSurvivalHotbar();
}

// 生存模式点马来剑槽 = 收回道具换回剑
function equipSurvivalSword() {
  equippedItem = null;
  if (typeof hideItemViewmodel === 'function') hideItemViewmodel();
  if (typeof swordGroup !== 'undefined' && swordGroup) swordGroup.visible = swordEquipped;
  setAttackBtnLabel('挥刀');
  renderSurvivalHotbar();
}

// 使用装备中的道具（攻击键触发）；联机客户端通知主机执行世界效果
function useSurvivalItem() {
  if (!equippedItem) return false;
  const itemId = equippedItem.id;
  const idx = survivalInventory.indexOf(equippedItem);
  if (MP.mode === 'client') {
    Bridge.send(JSON.stringify({type:'itemUse', token:MP._handshakeToken, itemId}));
    applySurvivalItemPreview(itemId); // 本地即时反馈（数值由主机state修正）
  } else {
    applySurvivalItemEffect(itemId, null);
  }
  // 消耗道具并换回马来剑
  if (idx >= 0) survivalInventory.splice(idx, 1);
  equippedItem = null;
  if (typeof hideItemViewmodel === 'function') hideItemViewmodel();
  if (typeof swordGroup !== 'undefined' && swordGroup) swordGroup.visible = swordEquipped;
  setAttackBtnLabel('挥刀');
  renderSurvivalHotbar();
  return true;
}

// 联机客户端使用道具后的本地预览（权威数值由主机计算并经state同步）
function applySurvivalItemPreview(itemId) {
  switch (itemId) {
    case 'heal':
      playerHealth = Math.min(survival.maxHp, playerHealth + 25);
      updateHealthUI();
      break;
    case 'speed': survival.speedBoost = true; survival.speedBoostTimer = 30; break;
    case 'invincible': survival.invincible = true; survival.invincibleTimer = 10; break;
    case 'damage': survival.swordDamageBonus = 15; survival.swordDamageTimer = 30; break;
  }
}

// 道具效果落地（主机/单机执行）：byClientId为null=主机自己
function applySurvivalItemEffect(itemId, byClientId) {
  switch (itemId) {
    case 'bomb': {
      let n = 0;
      for (const pig of survival.pigs) {
        if (pig.alive) { survivalPigKilled(pig, byClientId); n++; }
      }
      if (typeof showToast === 'function') showToast('💣 炸弹引爆！消灭' + n + '只福瑞', 1500);
      const flash = document.getElementById('hitFlash');
      if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 200); }
      break;
    }
    case 'heal':
      if (byClientId && MP.players[byClientId]) {
        const p = MP.players[byClientId];
        p.health = Math.min(MP.MAX_HEALTH, p.health + 25);
      } else {
        playerHealth = Math.min(survival.maxHp, playerHealth + 25);
        updateHealthUI();
        if (typeof showToast === 'function') showToast('❤️ 回血+25！', 1500);
      }
      break;
    case 'speed':
      if (byClientId && MP.players[byClientId]) {
        const p = MP.players[byClientId];
        p.buffs = p.buffs || { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
        p.buffs.speedUntil = gameTime + 30;
      } else {
        survival.speedBoost = true; survival.speedBoostTimer = 30;
        if (typeof showToast === 'function') showToast('⚡ 加速30秒！', 1500);
      }
      break;
    case 'invincible':
      if (byClientId && MP.players[byClientId]) {
        const p = MP.players[byClientId];
        p.buffs = p.buffs || { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
        p.buffs.invincibleUntil = gameTime + 10;
      } else {
        survival.invincible = true; survival.invincibleTimer = 10;
        if (typeof showToast === 'function') showToast('🛡️ 无敌10秒！', 1500);
      }
      break;
    case 'damage':
      if (byClientId && MP.players[byClientId]) {
        const p = MP.players[byClientId];
        p.buffs = p.buffs || { speedUntil: 0, damageUntil: 0, invincibleUntil: 0 };
        p.buffs.damageUntil = gameTime + 30;
      } else {
        survival.swordDamageBonus = 15; survival.swordDamageTimer = 30;
        if (typeof showToast === 'function') showToast('⚔️ 攻击强化30秒！', 1500);
      }
      break;
  }
  updateSurvivalUI();
}

function survivalGetSpeedMultiplier() {
  let mult = 1;
  if (survival.speedBoost) mult *= 1.3;
  return mult;
}
