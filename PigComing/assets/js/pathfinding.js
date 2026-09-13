// ==================== A* 寻路 ====================
function worldToGrid(x,z){return{c:Math.round(x/CELL),r:Math.round(z/CELL)};}
function gridToWorld(c,r){return{x:c*CELL,z:r*CELL};}
function isWalkable(r,c){if(r<0||r>=MAP_ROWS||c<0||c>=MAP_COLS)return false;return MAP[r][c]===0;}
// 猪重生安全点：预设的可行走格子中心，避免随机偏移落到墙格导致寻路失败
const PIG_RESPAWN_POINTS = [{c:14,r:1},{c:1,r:1},{c:15,r:10},{c:13,r:10},{c:8,r:1},{c:3,r:10}];
function findPigRespawnPoint() {
  const valid = PIG_RESPAWN_POINTS.filter(p => isWalkable(p.r,p.c));
  const p = valid.length ? valid[Math.floor(Math.random()*valid.length)] : {c:14,r:1};
  return gridToWorld(p.c, p.r);
}
function astar(startR,startC,endR,endC){
  if(!isWalkable(startR,startC)||!isWalkable(endR,endC))return[];
  const open=[],closed=new Set(),gScore={},fScore={},cameFrom={};
  const key=(r,c)=>r+','+c; const h=(r,c)=>Math.abs(r-endR)+Math.abs(c-endC);
  gScore[key(startR,startC)]=0; fScore[key(startR,startC)]=h(startR,startC);
  open.push({r:startR,c:startC,f:fScore[key(startR,startC)]});
  const dirs=[[-1,0],[1,0],[0,-1],[0,1]]; let iters=0;
  while(open.length>0&&iters<500){
    iters++; open.sort((a,b)=>a.f-b.f); const cur=open.shift(); const ck=key(cur.r,cur.c);
    if(cur.r===endR&&cur.c===endC){const path=[];let c2=ck;while(c2){const[r,c]=c2.split(',').map(Number);path.unshift({r,c});c2=cameFrom[c2];}return path;}
    closed.add(ck);
    for(const[dr,dc]of dirs){const nr=cur.r+dr,nc=cur.c+dc,nk=key(nr,nc);if(!isWalkable(nr,nc)||closed.has(nk))continue;const tg=(gScore[ck]||0)+1;if(tg<(gScore[nk]||Infinity)){cameFrom[nk]=ck;gScore[nk]=tg;fScore[nk]=tg+h(nr,nc);if(!open.find(n=>n.r===nr&&n.c===nc))open.push({r:nr,c:nc,f:fScore[nk]});}}
  }
  return[];
}
