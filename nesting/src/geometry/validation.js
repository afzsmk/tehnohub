import { area, bounds, signedArea } from "./geometry.js";
function segCross(a,b,c,d){
  const o=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ab1=o(a,b,c),ab2=o(a,b,d),cd1=o(c,d,a),cd2=o(c,d,b),eps=1e-8;
  return ((ab1>eps&&ab2<-eps)||(ab1<-eps&&ab2>eps))&&((cd1>eps&&cd2<-eps)||(cd1<-eps&&cd2>eps));
}
export function validateLoops(loops,tolerance=.35){
  const errors=[],warnings=[];
  (loops||[]).forEach((loop,i)=>{
    if(!Array.isArray(loop)||loop.length<3){errors.push("Контур "+(i+1)+" содержит менее 3 точек");return}
    if(loop.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))errors.push("Контур "+(i+1)+" содержит некорректные координаты");
    if(area(loop)<tolerance*tolerance)warnings.push("Контур "+(i+1)+" очень мал");
    for(let a=0;a<loop.length;a++)for(let b=a+1;b<loop.length;b++){
      const a2=(a+1)%loop.length,b2=(b+1)%loop.length;if(a===b||a2===b||a===b2)continue;
      if(segCross(loop[a],loop[a2],loop[b],loop[b2])){errors.push("Самопересечение в контуре "+(i+1));a=loop.length;break}
    }
  });
  return {ok:errors.length===0,errors,warnings};
}
export function validatePart(part,tolerance=.35){
  const loops=part?.geometry?.loops||[],v=validateLoops(loops,tolerance);
  if(!loops.length)v.errors.push("У детали отсутствует геометрия");
  const b=bounds(loops.flat()),signed=loops.map(signedArea);
  if(!(b.width>0&&b.height>0))v.errors.push("Нулевой габарит детали");
  if(signed.some(x=>Math.abs(x)<tolerance*tolerance))v.warnings.push("Один из контуров имеет очень малую площадь");
  return v;
}