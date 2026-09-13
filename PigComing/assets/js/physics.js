// ==================== 碰撞 ====================
function collides(x,z,radius){for(const w of walls){const cx=Math.max(w.minX,Math.min(x,w.maxX));const cz=Math.max(w.minZ,Math.min(z,w.maxZ));const dx=x-cx,dz=z-cz;if(dx*dx+dz*dz<radius*radius)return true;}return false;}
function moveWithCollision(obj,dx,dz,radius,canClip){
  if(canClip){obj.x+=dx;obj.z+=dz;return;}
  const nx=obj.x+dx; if(!collides(nx,obj.z,radius))obj.x=nx;
  const nz=obj.z+dz; if(!collides(obj.x,nz,radius))obj.z=nz;
}
