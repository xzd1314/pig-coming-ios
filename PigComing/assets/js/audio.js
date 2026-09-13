// ==================== 音频系统 ====================
let menuBgm = null;
let nextbotAudio = null;
let gasAudio = null;
let survivalAudio = null; // 打福瑞模式福瑞音效
let audioInited = false;
// 打猪模式音效
let sfxSwordDraw = null, sfxAttack1 = null, sfxAttack2 = null, sfxAttack3 = null;
// 黑猪模式音效
let sfxBpFront = null, sfxBpBack = null, sfxBpTurn = null;
function initAudio() {
  if (audioInited) return;
  try {
    menuBgm = new Audio(AUDIO_MENU_BGM);
    menuBgm.loop = true; menuBgm.volume = 0.6;
    nextbotAudio = new Audio(AUDIO_NEXTBOT);
    nextbotAudio.loop = true; nextbotAudio.volume = 0;
    gasAudio = new Audio(AUDIO_GAS);
    gasAudio.loop = false; gasAudio.volume = 0.8;
    // 打福瑞模式福瑞音效
    survivalAudio = new Audio(AUDIO_SURVIVAL);
    survivalAudio.loop = true; survivalAudio.volume = 0;
    // 打猪音效
    sfxSwordDraw = new Audio(AUDIO_SWORD_DRAW);
    sfxSwordDraw.volume = 0.9;
    sfxAttack1 = new Audio(AUDIO_ATTACK1); sfxAttack1.volume = 0.9;
    sfxAttack2 = new Audio(AUDIO_ATTACK2); sfxAttack2.volume = 0.9;
    sfxAttack3 = new Audio(AUDIO_ATTACK3); sfxAttack3.volume = 0.9;
    // 黑猪音效
    sfxBpFront = new Audio(AUDIO_BP_FRONT); sfxBpFront.volume = 0.8;
    sfxBpBack = new Audio(AUDIO_BP_BACK); sfxBpBack.volume = 0.8;
    sfxBpTurn = new Audio(AUDIO_BP_TURN); sfxBpTurn.volume = 0.9;
    audioInited = true;
    console.log('Audio initialized OK');
  } catch(e) { console.log('Audio init failed:', e); }
}
function playMenuBgm() {
  if (!menuBgm) return;
  if (menuBgm.paused) { menuBgm.currentTime = 0; menuBgm.play().catch(e=>{}); }
}
function stopMenuBgm() { if (!menuBgm) return; menuBgm.pause(); menuBgm.currentTime = 0; }
function updateNextbotAudio(dist) {
  if (!nextbotAudio) return;
  const maxDist = 25;
  let vol = dist < maxDist ? (1 - dist / maxDist) * 0.7 : 0;
  nextbotAudio.volume = Math.max(0, Math.min(1, vol));
  if (gameRunning && !gamePaused && dist < maxDist && nextbot.alive) {
    if (nextbotAudio.paused) nextbotAudio.play().catch(e=>{});
  } else { if (!nextbotAudio.paused) nextbotAudio.pause(); }
}
// 打福瑞模式：按最近福瑞距离播放音效（音量随距离衰减）
function updateSurvivalAudio(dist) {
  if (!survivalAudio) return;
  const maxDist = 25;
  let vol = dist < maxDist ? (1 - dist / maxDist) * 0.7 : 0;
  survivalAudio.volume = Math.max(0, Math.min(1, vol));
  if (gameMode === 'survival' && gameRunning && !gamePaused && dist < maxDist) {
    if (survivalAudio.paused) survivalAudio.play().catch(e=>{});
  } else { if (!survivalAudio.paused) survivalAudio.pause(); }
}
function stopSurvivalAudio() {
  if (survivalAudio && !survivalAudio.paused) { survivalAudio.pause(); survivalAudio.currentTime = 0; }
}
function playGasSound() { if (!gasAudio) return; gasAudio.currentTime = 0; gasAudio.play().catch(e=>{}); }
function playSfx(audio) { if (!audio) return; audio.currentTime = 0; audio.play().catch(e=>{}); }
// 黑猪模式音频队列播放：换面音效完才播放正/反面音乐
function bpPlayQueue() {
  if (bpAudioPlaying || bpAudioQueue.length === 0) return;
  const item = bpAudioQueue.shift();
  bpAudioPlaying = true;
  let done = false; // 防止ended与超时兜底双触发
  const onEnd = () => {
    if (done) return;
    done = true;
    item.audio.removeEventListener('ended', onEnd);
    bpAudioPlaying = false;
    if (item.callback) item.callback();
    bpPlayQueue();
  };
  item.audio.addEventListener('ended', onEnd);
  item.audio.currentTime = 0;
  item.audio.play().catch(e=>{ onEnd(); });
  // 兜底：如果音频太短或ended不触发，用超时
  setTimeout(() => { if (!done && item.audio.paused) { onEnd(); } }, (item.duration || 3) * 1000 + 200);
}
function bpStopAll() {
  bpAudioQueue = [];
  bpAudioPlaying = false;
  [sfxBpFront, sfxBpBack, sfxBpTurn].forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
}
