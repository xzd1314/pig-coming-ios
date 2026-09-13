// ==================== 初始化 ====================
function init() {
  if (window.__gameInited) return; // 幂等保护：防止双渲染循环/重复监听器
  window.__gameInited = true;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15152a);
  scene.fog = new THREE.Fog(0x15152a, 6, 30);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 100);
  renderer = new THREE.WebGLRenderer({canvas:document.getElementById('gameCanvas'),antialias:true,powerPreference:'high-performance'});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  ambientLight = new THREE.AmbientLight(0x7777aa, 0.55); scene.add(ambientLight);
  dirLight = new THREE.DirectionalLight(0xffffff, 0.4); dirLight.position.set(10,20,10); scene.add(dirLight);
  flashlight = new THREE.PointLight(0xffeedd, 0.9, 18);
  flashlight.position.set(0, PLAYER_H, 0);
  camera.add(flashlight); scene.add(camera);
  buildMap();
  createNextbot();
  createSword();
  createItemViewmodel();
  createAmbientExtras();
  initGasParticles();
  createSkyElements();
  window.addEventListener('resize', onResize);
  setupInput();
  setupSettings();
  setupMenu();
  clock = new THREE.Clock();
  animate();
}
let mazeFloor = null;
// 墙体实例化网格：全部墙合并为少量InstancedMesh，大幅减少draw call（移动端关键优化）
let mazeWallMeshes = [];
function buildMap() {
  const floorGeo = new THREE.PlaneGeometry(MAP_COLS*CELL, MAP_ROWS*CELL);
  const floorMat = new THREE.MeshStandardMaterial({color:0x353548,roughness:0.9});
  mazeFloor = new THREE.Mesh(floorGeo, floorMat);
  mazeFloor.rotation.x = -Math.PI/2; mazeFloor.position.set((MAP_COLS-1)*CELL/2,0,(MAP_ROWS-1)*CELL/2);
  mazeFloor.name = 'maze_floor';
  scene.add(mazeFloor);
  const ceilGeo = new THREE.PlaneGeometry(MAP_COLS*CELL, MAP_ROWS*CELL);
  const ceilMat = new THREE.MeshStandardMaterial({color:0x1e1e30,roughness:1});
  ceilingMesh = new THREE.Mesh(ceilGeo, ceilMat);
  ceilingMesh.rotation.x = Math.PI/2; ceilingMesh.position.set((MAP_COLS-1)*CELL/2,WALL_H,(MAP_ROWS-1)*CELL/2);
  ceilingMesh.name = 'maze_ceiling';
  scene.add(ceilingMesh);
  // 收集墙体碰撞数据并按材质分组
  const groups = [[],[]]; // [偶数格, 奇数格]
  for(let r=0;r<MAP_ROWS;r++){for(let c=0;c<MAP_COLS;c++){if(MAP[r][c]===1){
    groups[(r+c)%2].push({x:c*CELL,z:r*CELL});
    walls.push({minX:c*CELL-CELL/2,maxX:c*CELL+CELL/2,minZ:r*CELL-CELL/2,maxZ:r*CELL+CELL/2});
  }}}
  const wallMats = [
    new THREE.MeshStandardMaterial({color:0x556677,roughness:0.8}),
    new THREE.MeshStandardMaterial({color:0x5a5a78,roughness:0.8}),
  ];
  const wallGeo = new THREE.BoxGeometry(CELL,WALL_H,CELL);
  const m4 = new THREE.Matrix4();
  for (let g=0; g<2; g++) {
    if (groups[g].length === 0) continue;
    const inst = new THREE.InstancedMesh(wallGeo, wallMats[g], groups[g].length);
    for (let i=0;i<groups[g].length;i++) {
      m4.setPosition(groups[g][i].x, WALL_H/2, groups[g][i].z);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.name = 'maze_wall';
    scene.add(inst);
    mazeWallMeshes.push(inst);
  }
}
function hideMaze() {
  if (mazeFloor) mazeFloor.visible = false;
  if (ceilingMesh) ceilingMesh.visible = false;
  for (const m of mazeWallMeshes) m.visible = false;
}
function showMaze() {
  if (mazeFloor) mazeFloor.visible = true;
  if (ceilingMesh) ceilingMesh.visible = true;
  for (const m of mazeWallMeshes) m.visible = true;
}
function createNextbot() {
  const tex = new THREE.TextureLoader().load(NEXTBOT_TEX_DATA, function(t){t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;}, undefined, function(err){console.error('Nextbot texture FAILED:',err);});
  const mat = new THREE.MeshBasicMaterial({map:tex,transparent:true,alphaTest:0.1,side:THREE.DoubleSide});
  const geo = new THREE.PlaneGeometry(NEXTBOT_SIZE, NEXTBOT_SIZE);
  nextbot.mesh = new THREE.Mesh(geo, mat); nextbot.mesh.position.y = NEXTBOT_SIZE/2+0.15; scene.add(nextbot.mesh);
  const glowGeo = new THREE.PlaneGeometry(NEXTBOT_SIZE+0.5, NEXTBOT_SIZE+0.5);
  const glowMat = new THREE.MeshBasicMaterial({color:0xff2222,transparent:true,opacity:0.35,side:THREE.BackSide});
  nextbot.glowMesh = new THREE.Mesh(glowGeo, glowMat); nextbot.glowMesh.position.y = NEXTBOT_SIZE/2+0.15; scene.add(nextbot.glowMesh);
}
// 创建马来剑（第一人称武器）
function createSword() {
  swordGroup = new THREE.Group();
  const texLoader = new THREE.TextureLoader();
  const swordTex = texLoader.load(IMG_MALAY_SWORD_PNG, function(t){t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;});
  const swordMat = new THREE.MeshBasicMaterial({map:swordTex,transparent:true,alphaTest:0.1,side:THREE.DoubleSide});
  // 剑的平面，调整大小和位置
  const swordGeo = new THREE.PlaneGeometry(0.5, 2.2);
  swordMesh = new THREE.Mesh(swordGeo, swordMat);
  swordMesh.position.set(0.35, -0.3, -0.6);
  swordMesh.rotation.x = -0.2;
  swordMesh.rotation.z = 0.15;
  swordGroup.add(swordMesh);
  swordGroup.visible = false;
  swordGroup.renderOrder = 999;
  if (swordMesh) swordMesh.renderOrder = 1000;
  camera.add(swordGroup);
}
// ===== 道具手持视图（emoji画在Sprite上，替代第一人称武器位置）=====
let itemViewSprite = null;
function createItemViewmodel() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  itemViewSprite = new THREE.Sprite(mat);
  itemViewSprite.scale.set(0.9, 0.9, 1);
  itemViewSprite.position.set(0.5, -0.45, -1.0);
  itemViewSprite.visible = false;
  itemViewSprite.userData = { canvas, tex };
  camera.add(itemViewSprite);
}
function showItemViewmodel(emoji) {
  if (!itemViewSprite) return;
  const ctx = itemViewSprite.userData.canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '92px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 68);
  itemViewSprite.userData.tex.needsUpdate = true;
  itemViewSprite.visible = true;
}
function hideItemViewmodel() {
  if (itemViewSprite) itemViewSprite.visible = false;
}
function updateSwordAnimation(dt) {
  if (!swordEquipped || !swordGroup) return;
  if (attackAnimTimer > 0) {
    attackAnimTimer -= dt;
    const progress = 1 - (attackAnimTimer / 0.35);
    // 挥刀动画：根据段数不同
    if (attackStage === 1) {
      swordGroup.rotation.z = 0.15 + Math.sin(progress * Math.PI) * 1.2;
      swordGroup.rotation.x = -0.2 - Math.sin(progress * Math.PI) * 0.5;
    } else if (attackStage === 2) {
      swordGroup.rotation.z = 0.15 - Math.sin(progress * Math.PI) * 1.0;
      swordGroup.rotation.x = -0.2 + Math.sin(progress * Math.PI) * 0.6;
    } else if (attackStage === 3) {
      swordGroup.rotation.z = 0.15 + Math.sin(progress * Math.PI) * 1.5;
      swordGroup.rotation.x = -0.2 - Math.sin(progress * Math.PI) * 0.8;
      swordGroup.position.y = -0.3 + Math.sin(progress * Math.PI) * 0.2;
    }
    if (attackAnimTimer <= 0) {
      swordGroup.rotation.set(0,0,0);
      swordGroup.position.set(0,0,0);
      swordMesh.position.set(0.35, -0.3, -0.6);
      swordMesh.rotation.set(-0.2, 0, 0.15);
    }
  }
}
