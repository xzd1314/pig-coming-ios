(function(){
  'use strict';

  // ---------- 配置 ----------
  var MOUSE_SENSITIVITY = 0.0022;
  var KEYS = {};
  window.KEYS = KEYS; // 暴露给multiplayer.js/clientSendInput使用
  var pointerLocked = false;
  var initialized = false;

  // ---------- 工具 ----------
  function getJoystick() { return (typeof joystick !== 'undefined') ? joystick : null; }
  function getPlayer()   { return (typeof player   !== 'undefined') ? player   : null; }
  // 焦点在输入框时不处理游戏快捷键（否则打字会触发跳跃/锁定鼠标）
  function isTyping(e) {
    var t = e.target;
    return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  // ---------- 键盘事件 ----------
  function updateJoystickFromKeys(){
    var joy = getJoystick();
    if (!joy) return;
    var dx = 0, dy = 0;
    if (KEYS['KeyW'] || KEYS['ArrowUp'])    dy += 1;
    if (KEYS['KeyS'] || KEYS['ArrowDown'])  dy -= 1;
    if (KEYS['KeyA'] || KEYS['ArrowLeft'])  dx -= 1;
    if (KEYS['KeyD'] || KEYS['ArrowRight']) dx += 1;
    var len = Math.sqrt(dx*dx + dy*dy);
    if (len > 1) { dx /= len; dy /= len; }
    joy.dx = dx;
    joy.dy = dy;
    joy.active = (dx !== 0 || dy !== 0);
  }

  document.addEventListener('keydown', function(e){
    if (isTyping(e)) return;
    KEYS[e.code] = true;
    updateJoystickFromKeys();
    if (e.code === 'Space') { e.preventDefault(); tryJump(); }
    if (e.code === 'AltLeft') { e.preventDefault(); togglePointerLock(); }
  });

  document.addEventListener('keyup', function(e){
    if (isTyping(e)) { KEYS[e.code] = false; return; }
    KEYS[e.code] = false;
    updateJoystickFromKeys();
    if (e.code === 'Escape') { setTimeout(toggleSettings, 10); }
  });

  window.addEventListener('blur', function(){
    for (var k in KEYS) { KEYS[k] = false; }
    updateJoystickFromKeys();
  });

  // ---------- 跳跃 ----------
  function tryJump(){
    if (typeof doJump === 'function') { try { doJump(); } catch(e){} }
  }

  // ---------- 攻击 ----------
  function tryAttack(){
    if (typeof doAttack === 'function') { try { doAttack(); } catch(e){} }
  }

  // ---------- 设置面板 ----------
  function isSettingsOpen(){
    var panel = document.getElementById('settingsPanel');
    return panel && window.getComputedStyle(panel).display !== 'none';
  }
  function toggleSettings(){
    if (isSettingsOpen()) {
      if (typeof resumeGame === 'function') resumeGame();
    } else {
      if (typeof pauseGame === 'function') pauseGame();
    }
  }

  // ---------- 鼠标锁定 ----------
  function requestPointerLock(){
    var el = document.documentElement;
    if (el.requestPointerLock) el.requestPointerLock();
    else if (el.webkitRequestPointerLock) el.webkitRequestPointerLock();
  }

  function togglePointerLock(){
    if (pointerLocked) {
      if (document.exitPointerLock) document.exitPointerLock();
      else if (document.webkitExitPointerLock) document.webkitExitPointerLock();
    } else {
      var isRunning = (typeof gameRunning !== 'undefined') ? gameRunning : false;
      if (isRunning) requestPointerLock();
    }
  }

  document.addEventListener('pointerlockchange', function(){
    pointerLocked = !!(document.pointerLockElement || document.webkitPointerLockElement);
    // 显示/隐藏鼠标锁定提示
    var hint = document.getElementById('pointerLockHint');
    if (hint) {
      var isRunning = (typeof gameRunning !== 'undefined') ? gameRunning : false;
      hint.style.display = (!pointerLocked && isRunning) ? 'block' : 'none';
    }
  });
  document.addEventListener('webkitpointerlockchange', function(){
    pointerLocked = !!document.webkitPointerLockElement;
  });

  // === 修复视角卡死：点击Canvas自动重新锁定鼠标 ===
  document.addEventListener('click', function(e){
    if (pointerLocked) return;
    var isRunning = (typeof gameRunning !== 'undefined') ? gameRunning : false;
    if (!isRunning) return;
    // 不拦截菜单按钮、设置面板等UI元素的点击
    if (e.target.closest('#settingsPanel, #startScreen, #gameOverScreen, #modeSelectScreen, #playerSelectScreen, #srtSubMenu, #srtMultiLobby, #aboutScreen, #multiplayerScreen, #nameDialog, #ipDialog, #survivalSubMenu, #survivalMultiLobby, #survivalShop, #devCheatPanel, #devPasswordDialog, #hideSubMenu, #hideMultiLobby, #myInfoScreen, button, input, .menu-btn, .mode-card, .srt-option, .toggle, .hotbar-slot, #settingsBtn')) return;
    requestPointerLock();
  });

  // 鼠标移动 → 视角
  document.addEventListener('mousemove', function(e){
    if (!pointerLocked) return;
    var p = getPlayer();
    if (!p) return;
    var dx = e.movementX || e.webkitMovementX || 0;
    var dy = e.movementY || e.webkitMovementY || 0;
    p.yaw -= dx * MOUSE_SENSITIVITY;
    p.pitch -= dy * MOUSE_SENSITIVITY;
    var limit = Math.PI / 2 - 0.1;
    if (p.pitch > limit) p.pitch = limit;
    if (p.pitch < -limit) p.pitch = -limit;
  });

  // 鼠标左键 → 攻击
  document.addEventListener('mousedown', function(e){
    if (pointerLocked && e.button === 0) { tryAttack(); }
  });
  // 鼠标松开 → 枪战停止开火
  document.addEventListener('mouseup', function(e){
    if (e.button === 0 && typeof gunStopFire === 'function') { try { gunStopFire(); } catch(err){} }
  });

  // 枪战快捷键：1/2 切枪，R 换弹，V 全自动/半自动
  document.addEventListener('keydown', function(e){
    if (isTyping(e)) return;
    if (typeof gun === 'undefined' || !gun || !gun.active) return;
    if (e.code === 'Digit1') { gunSwitchWeapon(0); }
    else if (e.code === 'Digit2') { gunSwitchWeapon(1); }
    else if (e.code === 'KeyR') { gunTryReload(); }
    else if (e.code === 'KeyV') { gunToggleFireMode(); }
  });

  // ---------- 主循环 ----------
  function updateInput(){
    var joy = getJoystick();
    if (!joy) { requestAnimationFrame(updateInput); return; }

    var dx = 0, dy = 0;
    if (KEYS['KeyW'] || KEYS['ArrowUp'])    dy += 1;
    if (KEYS['KeyS'] || KEYS['ArrowDown'])  dy -= 1;
    if (KEYS['KeyA'] || KEYS['ArrowLeft'])  dx -= 1;
    if (KEYS['KeyD'] || KEYS['ArrowRight']) dx += 1;

    var len = Math.sqrt(dx*dx + dy*dy);
    if (len > 1) { dx /= len; dy /= len; }

    joy.dx = dx;
    joy.dy = dy;
    joy.active = (dx !== 0 || dy !== 0);

    if (KEYS['ShiftLeft'] || KEYS['ShiftRight']) {
      if (typeof sprintActive !== 'undefined' && typeof sprintTimer !== 'undefined' && typeof cooldownTimer !== 'undefined') {
        if (!sprintActive && cooldownTimer <= 0) {
          sprintActive = true;
          sprintTimer = (typeof SPRINT_DURATION !== 'undefined') ? SPRINT_DURATION : 3;
        }
      }
    }

    requestAnimationFrame(updateInput);
  }

  // ---------- 初始化 ----------
  // v4 修复：键盘事件直接更新 joystick，不依赖 updateInput 循环
  function init(){
    if (initialized) return;
    initialized = true;
    updateInput();
    console.log('[PC版] 键鼠控制已初始化（点击画面锁定鼠标）');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(init, 300); });
  }
})();
