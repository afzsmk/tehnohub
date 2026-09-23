import { contourInfo, loopsBounds, transformLoops } from "../geometry/geometry.js";

function resolvePart(plan,it){
  return plan.partMap.get(it.instanceId) || plan.partMap.get(String(it.instanceId||"").split("#")[0]) || null;
}
function geometryArea(part){
  const loops=part?.geometry?.loops||[],depths=part?.geometry?.loopDepths||[];
  let total=0;
  loops.forEach(function(loop,i){
    const a=Math.abs(loop.reduce(function(s,p,j){const q=loop[(j+1)%loop.length];return s+p.x*q.y-q.x*p.y},0)/2);
    total+=((depths[i]||0)%2)?-a:a;
  });
  return Math.max(0,total);
}
export function calculateMetrics(plan,material){
  let placed=0,partArea=0,sheetArea=0;
  (plan.sheets||[]).forEach(function(sh){
    const w=Math.max(0,Number(sh.width)||0),h=Math.max(0,Number(sh.height)||0);
    sheetArea+=w*h;placed+=(sh.items||[]).length;
    (sh.items||[]).forEach(function(it){const p=resolvePart(plan,it);if(p)partArea+=geometryArea(p)});
  });
  const t=Math.max(0,Number(plan.thickness)||0)/1000,d=Math.max(0,Number(material?.density)||0);
  const materialWeight=sheetArea/1e6*t*d,partWeight=partArea/1e6*t*d;
  const scrapArea=Math.max(0,sheetArea-partArea),scrapWeight=scrapArea/1e6*t*d;
  const utilization=sheetArea>0?partArea/sheetArea*100:0;
  return {sheets:(plan.sheets||[]).length,placed,total:plan.totalParts||0,
    notPlaced:Math.max(0,(plan.totalParts||0)-placed),partAreaM2:partArea/1e6,
    sheetAreaM2:sheetArea/1e6,scrapAreaM2:scrapArea/1e6,utilization,
    wastePercent:Math.max(0,100-utilization),partWeight,materialWeight,scrapWeight};
}
export function makeBom(plan){
  const map=new Map();
  (plan.sheets||[]).forEach(function(sh){(sh.items||[]).forEach(function(it){
    const p=resolvePart(plan,it);if(!p)return;
    const key=p.originalPartId||p.id,inf=contourInfo(p);
    if(!map.has(key))map.set(key,{id:key,name:p.name,ordered:p.quantity,placed:0,width:inf.width,height:inf.height,area:geometryArea(p)});
    map.get(key).placed++;
  })});
  (plan.originalParts||[]).forEach(function(p){const key=p.id,inf=contourInfo(p);if(!map.has(key))map.set(key,{id:key,name:p.name,ordered:p.quantity,placed:0,width:inf.width,height:inf.height,area:geometryArea(p)})});
  return [...map.values()];
}
function leftoverPolygons(plan,sheet){
  if(!window.ClipperLib)return null;
  const scale=10000,toClip=loop=>loop.map(q=>({X:Math.round(q.x*scale),Y:Math.round(q.y*scale)}));
  const subject=[{X:0,Y:0},{X:Math.round(sheet.width*scale),Y:0},{X:Math.round(sheet.width*scale),Y:Math.round(sheet.height*scale)},{X:0,Y:Math.round(sheet.height*scale)}];
  const cuts=[];
  (sheet.items||[]).forEach(function(it){
    const p=resolvePart(plan,it);if(!p)return;
    const loops=transformLoops(p.geometry.loops,it.rotation,it.x,it.y),depths=p.geometry.loopDepths||[];
    loops.forEach(function(loop,i){if((depths[i]||0)%2===0)cuts.push(toClip(loop))});
  });
  if(!cuts.length)return [subject.map(q=>({x:q.X/scale,y:q.Y/scale}))];
  const u=new window.ClipperLib.Clipper(),unioned=new window.ClipperLib.Paths();
  u.AddPaths(cuts,window.ClipperLib.PolyType.ptSubject,true);
  u.Execute(window.ClipperLib.ClipType.ctUnion,unioned,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftNonZero);
  const d=new window.ClipperLib.Clipper(),out=new window.ClipperLib.Paths();
  d.AddPath(subject,window.ClipperLib.PolyType.ptSubject,true);d.AddPaths(unioned,window.ClipperLib.PolyType.ptClip,true);
  if(!d.Execute(window.ClipperLib.ClipType.ctDifference,out,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftNonZero))return null;
  return out.map(poly=>poly.map(q=>({x:q.X/scale,y:q.Y/scale}))).filter(poly=>poly.length>=3);
}
export function calculateRemnants(plan,minSizeM=0.01){
  const out=[],minArea=Math.max(1e-6,Number(minSizeM)||0.01)*1e6;
  (plan.sheets||[]).forEach(function(sh,idx){
    const paths=leftoverPolygons(plan,sh);if(!paths)return;
    paths.forEach(function(poly){
      const a=Math.abs(poly.reduce(function(s,p,i){const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y},0)/2);
      const ratio=a/Math.max(1,sh.width*sh.height);if(a<minArea||ratio>.985)return;
      const bb=loopsBounds([poly]);
      out.push({id:crypto.randomUUID(),sheet:idx+1,area:a,width:bb.width,height:bb.height,loops:[poly],
        utilization:bb.width*bb.height>0?a/(bb.width*bb.height)*100:0,
        touchesEdge:Math.abs(bb.minX)<.5||Math.abs(bb.minY)<.5||Math.abs(bb.maxX-sh.width)<.5||Math.abs(bb.maxY-sh.height)<.5});
    });
  });
  return out.sort(function(a,b){return b.area-a.area});
}
export function getRemnantSummary(plan){const a=plan.remnants||[];return {count:a.length,areaM2:a.reduce(function(s,r){return s+r.area},0)/1e6}}
