// ============================================================
// 猪来了NextBot - 跨平台桥接（Tauri桌面 / iOS / Android / 纯浏览器）
// 联机通道优先级：
//   1. Tauri原生后端（Rust实现WebSocket服务器/客户端+UDP发现，桌面/移动通用）
//   2. 浏览器原生WebSocket（客户端模式兜底：安卓WebView/iOS WKWebView/纯浏览器）
//   3. window.webkit.messageHandlers.bridge（预留：iOS原生壳自定义桥接）
// 对外保持 window.AndroidBridge 与 window.NativeCallback 接口不变（修改器CDP兼容）
// ============================================================

(function() {
  'use strict';

  function isTauri() {
    return !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
  }

  function invoke(cmd, args) {
    return window.__TAURI__.core.invoke(cmd, args || {});
  }

  // 延迟取NativeCallback：本脚本先于multiplayer.js加载
  function nc() { return window.NativeCallback || null; }
  function callNC(name) {
    var c = nc();
    if (c && typeof c[name] === 'function') {
      var args = Array.prototype.slice.call(arguments, 1);
      c[name].apply(c, args);
    }
  }

  // ===== Tauri事件 → NativeCallback 映射（事件到达时才查找回调，规避加载顺序）=====
  var _tauriListenersReady = false;
  function setupTauriListeners() {
    if (_tauriListenersReady || !isTauri() || !window.__TAURI__.event) return;
    _tauriListenersReady = true;
    var listen = window.__TAURI__.event.listen;
    // 服务端模式事件
    listen('ws-client-connected', function(e) { callNC('onClientConnected', e.payload); });
    listen('ws-client-disconnected', function(e) { callNC('onClientDisconnected', e.payload); });
    listen('ws-server-message', function(e) {
      // payload为JSON字符串 {"id":"client_N","msg":"..."}
      try {
        var p = JSON.parse(e.payload);
        callNC('onMessage', p.id, p.msg);
      } catch (err) { console.error('[Tauri Bridge] bad server-message payload', err); }
    });
    // 客户端模式事件
    listen('ws-connected', function() { callNC('onConnected'); });
    listen('ws-disconnected', function() { callNC('onDisconnected'); });
    listen('ws-client-message', function(e) { callNC('onServerMessage', e.payload); });
    // UDP房间发现
    listen('room-found', function(e) { callNC('onRoomFound', e.payload); });
  }

  // ===== WebSocket实现 =====
  const WS = {
    client: null,       // 浏览器原生WebSocket（非Tauri环境的客户端模式）
    clients: new Map(), // 非Tauri环境无服务端能力，恒为空

    // --- 客户端：连接主机 ---
    connect(ip, port) {
      if (isTauri()) {
        setupTauriListeners();
        invoke('ws_connect', { ip: ip, port: port }).catch(function(e) {
          console.error('[WS Client] Connect failed:', e);
          // 连接失败也会触发断开回调，交给重连逻辑处理
          callNC('onDisconnected');
        });
        return;
      }
      // 浏览器/WebView兜底：原生WebSocket客户端
      this.disconnect();
      const url = 'ws://' + ip + ':' + port;
      console.log('[WS Client] Connecting to', url);
      const sock = new WebSocket(url);
      this.client = sock;
      sock.onopen = () => { if (this.client === sock) callNC('onConnected'); };
      sock.onmessage = (e) => { if (this.client === sock) callNC('onServerMessage', e.data); };
      sock.onclose = () => {
        if (this.client === sock) { this.client = null; callNC('onDisconnected'); }
      };
      sock.onerror = (e) => { console.error('[WS Client] Error:', e.message || e); };
    },

    disconnect() {
      if (isTauri()) { invoke('ws_disconnect').catch(function(){}); return; }
      if (this.client) {
        try { this.client.close(); } catch(e) {}
        this.client = null;
      }
    },

    send(msg) {
      if (isTauri()) { invoke('ws_send', { msg: msg }).catch(function(){}); return; }
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        this.client.send(msg);
      }
    },

    // --- 服务端：创建房间 ---
    startServer(port) {
      if (isTauri()) {
        setupTauriListeners();
        invoke('ws_start_server', { port: port }).then(() => {
          return invoke('get_local_ip');
        }).then((ip) => {
          callNC('onServerStarted', ip || '127.0.0.1', port);
        }).catch((e) => {
          console.error('[WS Server] Start failed:', e);
          callNC('onServerError', String(e && e.message || e));
        });
        return;
      }
      // 浏览器环境无法创建WebSocket服务端：如实报错（不再假成功）
      console.warn('[WS Server] 当前环境缺少原生后端，无法创建房间');
      callNC('onServerError', '当前环境不支持创建房间');
    },

    stopServer() {
      if (isTauri()) { invoke('ws_stop_server').catch(function(){}); return; }
      for (const [, ws] of this.clients) {
        try { ws.close(); } catch(e) {}
      }
      this.clients.clear();
      callNC('onServerStopped');
    },

    broadcast(msg) {
      if (isTauri()) { invoke('ws_broadcast', { msg: msg }).catch(function(){}); return; }
      for (const [, ws] of this.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
      }
    },

    sendTo(clientId, msg) {
      if (isTauri()) { invoke('ws_send_to', { id: clientId, msg: msg }).catch(function(){}); return; }
      const ws = this.clients.get(clientId);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  };

  // ===== UDP房间发现（Tauri Rust后端）=====
  const UDP = {
    async startBroadcast(roomInfo) {
      if (isTauri()) {
        try {
          setupTauriListeners();
          await invoke('start_udp_broadcast', { roomInfo: roomInfo });
          return;
        } catch(e) { console.error('[UDP Broadcast] Failed:', e); return; }
      }
      // 非Tauri环境：无UDP能力，静默跳过（房间发现不可用，但手动IP联机可用）
      console.warn('[UDP] 当前环境不支持房间广播/扫描，请手动输入IP联机');
    },
    async stopBroadcast() {
      if (isTauri()) { try { await invoke('stop_udp_broadcast'); } catch(e) {} }
    },
    async startScan() {
      if (isTauri()) {
        try {
          setupTauriListeners();
          await invoke('start_udp_scan');
          return;
        } catch(e) { console.error('[UDP Scan] Failed:', e); }
      }
    },
    async stopScan() {
      if (isTauri()) { try { await invoke('stop_udp_scan'); } catch(e) {} }
    }
  };

  async function getLocalIP() {
    if (isTauri()) {
      try { return await invoke('get_local_ip'); } catch(e) {}
    }
    return '127.0.0.1';
  }

  // ===== 兼容层：AndroidBridge接口（修改器CDP / 安卓WebView依赖此接口）=====
  // 关键：非Tauri环境下，如果已有原生桥接（安卓注入的AndroidBridge或iOS的webkit桥接），
  // 绝不能覆盖window.AndroidBridge，否则会拦截原生联机通道导致局域网无法开启。
  // 仅在Tauri环境（桌面版）或纯浏览器（无任何原生桥接）时才设置兼容层。
  var _hasNativeBridge = !!(window.AndroidBridge && typeof window.AndroidBridge.call === 'function') ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge);
  if (isTauri() || !_hasNativeBridge) {
  window.AndroidBridge = {
    call: function(payload) {
      try {
        var p = JSON.parse(payload);
        switch (p.method) {
          case 'startServer': WS.startServer(p.args.port || 8765); return null;
          case 'stopServer': WS.stopServer(); return null;
          case 'broadcast': WS.broadcast(p.args.msg); return null;
          case 'sendTo': WS.sendTo(p.args.id, p.args.msg); return null;
          case 'connect': WS.connect(p.args.ip, p.args.port); return null;
          case 'disconnect': WS.disconnect(); return null;
          case 'send': WS.send(p.args.msg); return null;
          case 'startBroadcast': UDP.startBroadcast(p.args.roomInfo); return null;
          case 'stopBroadcast': UDP.stopBroadcast(); return null;
          case 'startScan': UDP.startScan(); return null;
          case 'stopScan': UDP.stopScan(); return null;
          case 'getLocalIP': return getLocalIP();
          default:
            console.warn('[Bridge] Unknown method:', p.method);
            return null;
        }
      } catch(e) {
        console.error('[Bridge] Error:', e);
        return null;
      }
    }
  };
  } // end if (isTauri || !_hasNativeBridge)

  console.log('[CrossBridge] 跨平台桥接就绪（Tauri=' + isTauri() + '，原生桥接=' + _hasNativeBridge + '）');
})();
