// ==================== 设置 ====================
function setupSettings() {
  // --- 设置按钮：打开面板 ---
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (gameRunning && !gamePaused) pauseGame();
    updateSettingsPanelVisibility();
    var speedLabel = document.getElementById('speedLabel');
    if (speedLabel) speedLabel.textContent = (gameMode === 'srt') ? 'SRT移动速度' : '猪移动速度';
  });
  document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    if (gameRunning && gamePaused) resumeGame();
  });
  document.getElementById('returnMenuBtn').addEventListener('click', returnToMenu);
  // --- 猪速度滑块 ---
  var speedSlider = document.getElementById('pigSpeedSlider');
  var speedVal = document.getElementById('pigSpeedVal');
  if (speedSlider) speedSlider.addEventListener('input', () => {
    settings.pigSpeed = parseInt(speedSlider.value);
    speedVal.textContent = settings.pigSpeed;
    if (MP.mode === 'host') broadcastSettings();
  });
  // --- 直接绑定每个toggle的点击事件（最可靠的方式）---
  // 辅助函数：绑定toggle点击，同时让整行可点击
  function bindToggle(toggleId, handler) {
    var toggleEl = document.getElementById(toggleId);
    if (!toggleEl) return;
    // 直接在toggle元素上绑定
    toggleEl.addEventListener('click', function(e) {
      e.stopPropagation();
      handler(toggleEl);
    });
    // 让整个setting-row也可以点击触发toggle
    var row = toggleEl.parentElement;
    if (row && row.classList.contains('setting-row')) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', function(e) {
        // 如果点击的是toggle本身，已经处理过了，跳过
        if (e.target === toggleEl || e.target.closest && e.target.closest('#' + toggleId)) return;
        handler(toggleEl);
      });
    }
  }
  // 穿墙模式
  bindToggle('toggleNoclip', function(toggleEl) {
    settings.noclip = !settings.noclip;
    toggleEl.classList.toggle('on', settings.noclip);
    if (MP.mode === 'host') broadcastSettings();
  });
  // 无AI
  bindToggle('toggleNoAI', function(toggleEl) {
    if (MP.mode === 'client') return;
    settings.noAI = !settings.noAI;
    toggleEl.classList.toggle('on', settings.noAI);
    if (MP.mode === 'host') broadcastSettings();
  });
  // 白天模式
  bindToggle('toggleDayMode', function(toggleEl) {
    if (MP.mode === 'client') return;
    settings.dayMode = !settings.dayMode;
    toggleEl.classList.toggle('on', settings.dayMode);
    applyDayMode();
    if (MP.mode === 'host') broadcastSettings();
  });
  // 毒气模式
  bindToggle('toggleGasMode', function(toggleEl) {
    if (MP.mode === 'client') return;
    settings.gasMode = !settings.gasMode;
    toggleEl.classList.toggle('on', settings.gasMode);
    if (settings.gasMode) {
      playGasSound(); enableGasEffect();
    } else {
      disableGasEffect();
    }
    if (MP.mode === 'host') broadcastSettings();
  });
  // 错误显示
  bindToggle('toggleErrorDisplay', function(toggleEl) {
    window._showErrors = !window._showErrors;
    toggleEl.classList.toggle('on', window._showErrors);
  });
  // 局域网联机
  bindToggle('toggleMultiplayer', function(toggleEl) {
    var mpRow = document.getElementById('mpToggleRow');
    if (mpRow && mpRow.classList.contains('disabled')) return;
    if (MP.mode === 'host') return;
    MP.onServerReady = (ip, port) => {
      toggleEl.classList.add('on');
      mpRow.classList.add('disabled');
      var info = document.getElementById('mpServerInfo');
      info.style.display = 'block';
      info.textContent = '局域网联机已开启  IP: ' + ip + '  端口: ' + port;
      hostBroadcastRoom();
    };
    hostStartServer();
  });
  // --- 错误显示默认值 ---
  window._showErrors = false;
  // --- 全局错误处理 ---
  window.addEventListener('error', (e) => {
    if (!window._showErrors) return;
    var errDiv = document.getElementById('globalErrorDisplay');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.id = 'globalErrorDisplay';
      errDiv.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:rgba(255,0,0,0.9);color:#fff;padding:10px;padding-right:40px;z-index:50;font-size:13px;word-break:break-all;white-space:pre-wrap;max-height:40vh;overflow:auto;cursor:pointer;';
      errDiv.title = '点击关闭';
      errDiv.onclick = () => { errDiv.style.display = 'none'; };
      document.body.appendChild(errDiv);
    }
    errDiv.textContent = 'ERROR: ' + e.message + '\n' + e.filename + ':' + e.lineno + '\n(点击关闭)';
    errDiv.style.display = 'block';
  });
}

// 根据联机模式显示/隐藏设置项
function updateSettingsPanelVisibility() {
  const isClient = MP.mode === 'client';
  const isHost = MP.mode === 'host';
  // 客户端隐藏：猪速度、无AI、白天、毒气、联机开关
  document.getElementById('pigSpeedSlider').parentElement.style.display = isClient ? 'none' : 'flex';
  document.getElementById('toggleNoAI').parentElement.style.display = isClient ? 'none' : 'flex';
  document.getElementById('toggleDayMode').parentElement.style.display = isClient ? 'none' : 'flex';
  document.getElementById('toggleGasMode').parentElement.style.display = isClient ? 'none' : 'flex';
  document.getElementById('mpToggleRow').style.display = (isClient || (gameMode === 'srt' && MP.mode === 'offline')) ? 'none' : 'flex';
  // 客户端显示连接信息
  const connectInfo = document.getElementById('mpConnectInfo');
  if (isClient) {
    connectInfo.style.display = 'block';
    connectInfo.textContent = '已连接到房间，设置由房主同步';
  } else {
    connectInfo.style.display = 'none';
  }
  // 房主已开启联机时显示IP
  if (isHost && MP.serverRunning) {
    document.getElementById('mpServerInfo').style.display = 'block';
  }
}
// ==================== 输入 ====================
function setupInput() {
  const base = document.getElementById('joystickBase');
  const knob = document.getElementById('joystickKnob');
  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    joystick.active = true; joystick.id = t.identifier;
    const rect = base.getBoundingClientRect();
    joystick.cx = rect.left+rect.width/2; joystick.cy = rect.top+rect.height/2;
    updateJoy(t.clientX, t.clientY);
  }, {passive:false});
  base.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === joystick.id) updateJoy(t.clientX, t.clientY);
  }, {passive:false});
  base.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joystick.id) {
        joystick.active = false; joystick.id = null; joystick.dx = 0; joystick.dy = 0;
        knob.style.transform = 'translate(-50%, -50%)';
      }
    }
  }, {passive:false});
  function updateJoy(x,y) {
    let dx = x-joystick.cx, dy = y-joystick.cy;
    const maxR = 42, d = Math.sqrt(dx*dx+dy*dy);
    if (d > maxR) { dx = (dx/d)*maxR; dy = (dy/d)*maxR; }
    joystick.dx = dx/maxR; joystick.dy = -dy/maxR;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  // 右半屏视角（修复手机端视角卡死）
  document.addEventListener('touchstart', (e) => {
    // 如果设置面板/任何菜单弹窗打开，不拦截触摸（让点击穿透到toggle等UI元素）
    var sp = document.getElementById('settingsPanel');
    if (sp && sp.style.display === 'flex') return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth*0.38) continue;
      if (t.clientY > window.innerHeight-110 && t.clientX > window.innerWidth-200) continue;
      if (t.clientY < 60 && t.clientX > window.innerWidth-70) continue;
      // 如果上一个触摸没正常结束（被系统取消），强制重置
      if (lookTouch.active) {
        lookTouch.active = false; lookTouch.id = null;
      }
      lookTouch.active = true; lookTouch.id = t.identifier;
      lookTouch.lastX = t.clientX; lookTouch.lastY = t.clientY;
      lookTouch.lastTime = Date.now();
    }
  }, {passive:false});
  document.addEventListener('touchmove', (e) => {
    // 设置面板打开时停止视角控制
    var sp = document.getElementById('settingsPanel');
    if (sp && sp.style.display === 'flex') {
      lookTouch.active = false; lookTouch.id = null;
      return;
    }
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouch.id) {
        const ddx = t.clientX-lookTouch.lastX, ddy = t.clientY-lookTouch.lastY;
        player.yaw -= ddx*0.005; player.pitch -= ddy*0.005;
        player.pitch = Math.max(-Math.PI/2+0.1, Math.min(Math.PI/2-0.1, player.pitch));
        lookTouch.lastX = t.clientX; lookTouch.lastY = t.clientY;
        lookTouch.lastTime = Date.now();
      }
    }
  }, {passive:false});
  document.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouch.id) { lookTouch.active = false; lookTouch.id = null; }
    }
  }, {passive:false});
  // 修复：触摸被系统取消时也重置状态（如下拉通知栏、来电等）
  document.addEventListener('touchcancel', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouch.id) { lookTouch.active = false; lookTouch.id = null; }
    }
  }, {passive:false});
  // 修复：定期检测触摸是否超时（超过2秒无move则重置，防止卡死）
  setInterval(() => {
    if (lookTouch.active && lookTouch.lastTime && Date.now() - lookTouch.lastTime > 2000) {
      lookTouch.active = false; lookTouch.id = null;
    }
  }, 1000);
  // 冲刺
  document.getElementById('sprintBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!sprintActive && cooldownTimer <= 0 && gameRunning && !gamePaused && playerHealth > 0
        && !(MP.mode === 'client' && MP._clientDead) && !(MP.mode === 'host' && MP._hostDead)) {
      sprintActive = true; sprintTimer = SPRINT_DURATION;
    }
  }, {passive:false});
  // 跳跃
  document.getElementById('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    // 同步KEYS['Space']，让clientSendInput能检测到spaceHeld=true并发送跳跃请求
    if (typeof KEYS !== 'undefined') KEYS['Space'] = true;
    doJump();
  }, {passive:false});
  document.getElementById('jumpBtn').addEventListener('touchend', (e) => {
    if (typeof KEYS !== 'undefined') KEYS['Space'] = false;
  }, {passive:false});
  // 挥刀
  document.getElementById('attackBtn').addEventListener('touchstart', (e) => {
    e.preventDefault(); doAttack();
  }, {passive:false});
  // 物品栏 - 马来剑
  document.getElementById('slotSword').addEventListener('click', toggleSword);
  // ===== 枪战模式移动端按钮 =====
  const fireBtn = document.getElementById('gunFireBtn');
  if (fireBtn) {
    fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (typeof gunStartFire === 'function') gunStartFire();
    }, {passive:false});
    fireBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (typeof gunStopFire === 'function') gunStopFire();
    }, {passive:false});
  }
  const reloadBtn = document.getElementById('gunReloadBtn');
  if (reloadBtn) {
    reloadBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (typeof gunTryReload === 'function') gunTryReload();
    }, {passive:false});
  }
  const switchBtn = document.getElementById('gunSwitchBtn');
  if (switchBtn) {
    switchBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (typeof gun === 'undefined' || !gun || !gun.active) return;
      if (typeof gunSwitchWeapon === 'function') gunSwitchWeapon(gun.weapon === 0 ? 1 : 0);
    }, {passive:false});
  }
}
