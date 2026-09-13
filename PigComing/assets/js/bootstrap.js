// ============================================================
// 猪来了NextBot - Bootstrap
// 所有JS模块加载完毕后，调用init()启动游戏
// 所有函数/变量保持全局作用域，确保修改器CDP注入兼容
// ============================================================

// 等待DOM和所有脚本加载完毕
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(function() { init(); }, 100);
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() { init(); }, 100);
  });
}
