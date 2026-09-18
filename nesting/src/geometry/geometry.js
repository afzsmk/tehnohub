export function signedArea(points){
  let a=0;
  for(let i=0;i<points.length;i++){ const p=points[i], q=points[(i+1)%points.length]; a += p.x*q.y-q.x*p.y; }
  return a/2;
}
export function area(points){ return Math.abs(signedArea(points)); }
export function bounds(points){
  if(!points?.length) return {x:0,y:0,width:0,height:0,minX:0,minY:0,maxX:0,maxY:0};
  let minX=points[0].x,maxX=points[0].x,minY=points[0].y,maxY=points[0].y;
  for(const p of points){ if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x; if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY,minX,minY,maxX,maxY};
}
export function pointInPolygon(p, poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    const hit=((a.y>p.y)!==(b.y>p.y)) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y||1e-30)+a.x;
    if(hit) inside=!inside;
  }
  return inside;
}
export function rotatePoint(p, deg){
  const r=deg*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
  return {x:p.x*c-p.y*s,y:p.x*s+p.y*c};
}
export function transformLoops(loops, deg=0, dx=0, dy=0){
  return loops.map(loop=>loop.map(p=>{const q=rotatePoint(p,deg); return {x:q.x+dx,y:q.y+dy};}));
}
export function normalizeLoops(loops){
  const pts=loops.flat();
  const b=bounds(pts);
  return loops.map(loop=>loop.map(p=>({x:p.x-b.minX,y:p.y-b.minY})));
}
export function flattenLoops(loops){ return loops.flatMap(x=>x); }
export function loopsBounds(loops){ return bounds(flattenLoops(loops)); }
export function pathD(loop){
  if(!loop?.length) return "";
  return "M "+loop.map(p=>p.x+" "+p.y).join(" L ")+" Z";
}
export function loopsToPathD(loops){ return loops.map(pathD).join(" "); }

export function groupLoopsIntoParts(loops, meta={}){
  const items=loops.filter(p=>p?.length>=3).map((points,i)=>({points, index:i, area:area(points)})).sort((a,b)=>b.area-a.area);
  const parent=new Array(items.length).fill(-1);
  for(let i=0;i<items.length;i++){
    const p=items[i].points[0];
    let best=-1,bestArea=Infinity;
    for(let j=0;j<i;j++){
      if(items[j].area>items[i].area && items[j].area<bestArea && pointInPolygon(p,items[j].points)){ best=j; bestArea=items[j].area; }
    }
    parent[i]=best;
  }
  const depth=parent.map((_,i)=>{ let d=0,k=parent[i]; while(k>=0){d++;k=parent[k];} return d; });
  const parts=[];
  for(let i=0;i<items.length;i++){
    if(parent[i]!==-1) continue;
    const descendants=[];
    for(let j=0;j<items.length;j++){
      let k=j; while(k>=0 && k!==i) k=parent[k];
      if(k===i) descendants.push({points:items[j].points, depth:depth[j]});
    }
    parts.push({
      id:crypto.randomUUID(), name:meta.name || ("Деталь "+(parts.length+1)), quantity:1,
      source:meta.source||"unknown", layers:meta.layers||[],
      geometry:{ loops:normalizeLoops(descendants.map(d=>d.points)), loopDepths:descendants.map(d=>d.depth) }
    });
  }
  return parts;
}

export function contourInfo(part){
  const pts=flattenLoops(part.geometry?.loops||[]);
  const b=bounds(pts);
  const loops=part.geometry?.loops||[];
  const holeCount=(part.geometry?.loopDepths||loops.map((_,i)=>i===0?0:1)).filter(d=>d%2===1).length;
  return {width:b.width,height:b.height,area:loops.reduce((sum,l,i)=>sum + ((part.geometry.loopDepths?.[i]||0)%2 ? -area(l):area(l))), holeCount};
}
