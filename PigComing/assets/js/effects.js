// ==================== 毒气烟雾粒子系统 ====================
let gasParticles = null, gasParticleSystem = null;
let sunMesh = null, sunGlow = null, clouds = [], ceilingMesh = null;
function initGasParticles() {
  if (gasParticleSystem) return;
  const particleCount = 120;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = [], sizes = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    positions[i*3] = (Math.random()-0.5)*6; positions[i*3+1] = Math.random()*3; positions[i*3+2] = (Math.random()-0.5)*6;
    velocities.push({x:(Math.random()-0.5)*0.3, y:Math.random()*0.5+0.2, z:(Math.random()-0.5)*0.3});
    sizes[i] = Math.random()*2+1;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({color:0x33ff33,size:1.5,transparent:true,opacity:0.4,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true});
  gasParticleSystem = new THREE.Points(geometry, material);
  gasParticleSystem.visible = false;
  gasParticleSystem.userData.velocities = velocities;
  gasParticleSystem.userData.particleCount = particleCount;
  scene.add(gasParticleSystem);
}
function updateGasParticles(dt) {
  if (!gasParticleSystem || !gasParticleSystem.visible) return;
  const positions = gasParticleSystem.geometry.attributes.position.array;
  const velocities = gasParticleSystem.userData.velocities;
  const count = gasParticleSystem.userData.particleCount;
  for (let i = 0; i < count; i++) {
    positions[i*3] += velocities[i].x*dt; positions[i*3+1] += velocities[i].y*dt; positions[i*3+2] += velocities[i].z*dt;
    if (positions[i*3+1] > 4 || Math.abs(positions[i*3]) > 5 || Math.abs(positions[i*3+2]) > 5) {
      positions[i*3] = (Math.random()-0.5)*4; positions[i*3+1] = Math.random()*0.5; positions[i*3+2] = (Math.random()-0.5)*4;
    }
  }
  gasParticleSystem.geometry.attributes.position.needsUpdate = true;
  gasParticleSystem.position.set(player.x, 0, player.z);
}
function enableGasEffect() { initGasParticles(); if (gasParticleSystem) gasParticleSystem.visible = true; document.getElementById('gasOverlay').style.opacity = '1'; }
function disableGasEffect() { if (gasParticleSystem) gasParticleSystem.visible = false; document.getElementById('gasOverlay').style.opacity = '0'; }
// ==================== 白天模式天空 ====================
function createSkyElements() {
  const sunGeo = new THREE.SphereGeometry(3, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({color:0xffdd44});
  sunMesh = new THREE.Mesh(sunGeo, sunMat); sunMesh.position.set(20,25,-15); sunMesh.visible = false; scene.add(sunMesh);
  const glowGeo = new THREE.SphereGeometry(5, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({color:0xffee88,transparent:true,opacity:0.25,side:THREE.BackSide});
  sunGlow = new THREE.Mesh(glowGeo, glowMat); sunGlow.position.copy(sunMesh.position); sunGlow.visible = false; scene.add(sunGlow);
  const cloudPositions = [{x:-15,y:18,z:10,scale:1.2},{x:10,y:22,z:-20,scale:1.0},{x:-25,y:20,z:-10,scale:1.5},{x:25,y:16,z:5,scale:0.8},{x:0,y:24,z:25,scale:1.3},{x:-8,y:19,z:-28,scale:0.9}];
  for (const cp of cloudPositions) {
    const cloudGroup = new THREE.Group();
    const blobCount = 3 + Math.floor(Math.random()*3);
    for (let i = 0; i < blobCount; i++) {
      const r = (1.5+Math.random()*2)*cp.scale;
      const blobGeo = new THREE.SphereGeometry(r, 12, 12);
      const blobMat = new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.75,depthWrite:false});
      const blob = new THREE.Mesh(blobGeo, blobMat);
      blob.position.set((Math.random()-0.5)*5*cp.scale,(Math.random()-0.5)*1.5*cp.scale,(Math.random()-0.5)*3*cp.scale);
      cloudGroup.add(blob);
    }
    cloudGroup.position.set(cp.x,cp.y,cp.z); cloudGroup.visible = false;
    cloudGroup.userData.speed = 0.3+Math.random()*0.4; cloudGroup.userData.baseX = cp.x;
    clouds.push(cloudGroup); scene.add(cloudGroup);
  }
}
function updateClouds(dt) { for (const c of clouds) { if (!c.visible) continue; c.position.x += c.userData.speed*dt; if (c.position.x > 35) c.position.x = -35; } }
function showSkyElements(show) { if (sunMesh) sunMesh.visible = show; if (sunGlow) sunGlow.visible = show; for (const c of clouds) c.visible = show; }
// ==================== 战斗特效：粒子/击杀动画 ====================
let activeEffects = [];   // 粒子与死亡动画实例
let ambientDust = null;   // 迷宫环境灰尘
let lampLight = null;     // 迷宫闪烁吊灯
let lampFlickerT = 0;
// 受击粒子：小型迸溅
function spawnHitParticles(x, y, z, colorHex) {
  if (typeof scene === 'undefined' || !scene) return;
  spawnParticleBurst(x, y, z, colorHex || 0xffaa33, 12, 0.16, 0.45);
}
// 击杀爆裂：更大的粒子环
function spawnKillBurst(x, y, z, colorHex) {
  if (typeof scene === 'undefined' || !scene) return;
  spawnParticleBurst(x, y, z, colorHex || 0xff4422, 26, 0.24, 0.8);
}
function spawnParticleBurst(x, y, z, colorHex, count, size, life) {
  try {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      vel.push({ x: Math.cos(a)*sp, y: 1.5 + Math.random()*3, z: Math.sin(a)*sp });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: colorHex, size, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    activeEffects.push({ points: pts, vel, life: 0, max: life });
  } catch (e) {}
}
// 死亡动画：目标旋转缩小后隐藏（结束后由动画隐藏mesh）
function animateDeath(mesh) {
  if (!mesh) return;
  mesh.visible = true;
  activeEffects.push({ deathMesh: mesh, life: 0, max: 0.5 });
}
// 重生时恢复mesh变换（死亡动画会改scale/rotation）
function resetEntityMesh(mesh) {
  if (!mesh) return;
  mesh.visible = true;
  mesh.scale.set(1, 1, 1);
  mesh.rotation.z = 0;
}
function updateEffects(dt) {
  // 粒子与死亡动画
  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const e = activeEffects[i];
    e.life += dt;
    if (e.points) {
      const arr = e.points.geometry.attributes.position.array;
      for (let j = 0; j < e.vel.length; j++) {
        arr[j*3] += e.vel[j].x * dt;
        arr[j*3+1] += e.vel[j].y * dt;
        arr[j*3+2] += e.vel[j].z * dt;
        e.vel[j].y -= 9 * dt;
        if (arr[j*3+1] < 0.05) arr[j*3+1] = 0.05;
      }
      e.points.geometry.attributes.position.needsUpdate = true;
      e.points.material.opacity = Math.max(0, 1 - e.life / e.max);
    }
    if (e.deathMesh) {
      const t = Math.min(1, e.life / e.max);
      e.deathMesh.rotation.z = t * Math.PI * 1.5;
      const s = Math.max(0.05, 1 - t * 0.95);
      e.deathMesh.scale.set(s, s, s);
      if (t >= 1) e.deathMesh.visible = false;
    }
    if (e.life >= e.max) {
      if (e.points) { scene.remove(e.points); e.points.geometry.dispose(); e.points.material.dispose(); }
      activeEffects.splice(i, 1);
    }
  }
  // 迷宫灯光闪烁（环境氛围）
  if (typeof lampLight !== 'undefined' && lampLight && mazeFloor && mazeFloor.visible) {
    lampFlickerT += dt;
    lampLight.intensity = 0.55 + Math.sin(lampFlickerT * 13) * 0.06 + Math.random() * 0.05;
  }
  // 环境灰尘（普通/打猪模式迷宫内）
  if (ambientDust && ambientDust.visible) {
    const arr = ambientDust.geometry.attributes.position.array;
    for (let j = 0; j < arr.length; j += 3) {
      arr[j] += Math.sin(j + performance.now() * 0.0004) * 0.08 * dt;
      arr[j+1] += 0.06 * dt;
      if (arr[j+1] > 3) arr[j+1] = 0.2;
    }
    ambientDust.geometry.attributes.position.needsUpdate = true;
    ambientDust.position.set(player.x, 0, player.z);
  }
}
// 创建迷宫环境灰尘与闪烁吊灯
function createAmbientExtras() {
  try {
    const n = 50;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i*3] = (Math.random()-0.5) * 16;
      pos[i*3+1] = Math.random() * 3;
      pos[i*3+2] = (Math.random()-0.5) * 16;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x888899, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false });
    ambientDust = new THREE.Points(geo, mat);
    ambientDust.visible = false;
    scene.add(ambientDust);
    lampLight = new THREE.PointLight(0xffe8c8, 0.6, 20);
    lampLight.position.set((MAP_COLS-1)*CELL/2, WALL_H - 0.3, (MAP_ROWS-1)*CELL/2);
    scene.add(lampLight);
  } catch (e) {}
}
function setAmbientDustVisible(v) { if (ambientDust) ambientDust.visible = v; }
