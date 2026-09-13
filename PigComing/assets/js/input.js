// ==================== 循环 ====================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
}
function onResize() {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
// 注意：init()由bootstrap.js统一调用（DOM与全部脚本就绪后），
// 此处不能重复调用，否则会产生双渲染循环+重复事件监听
