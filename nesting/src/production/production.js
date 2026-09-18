import { contourInfo, loopsBounds, transformLoops } from "../geometry/geometry.js";
function resolvePart(plan,it){ return plan.partMap.get(it.instanceId) || plan.partMap.get(String(it.instanceId||"").split("#")[0]) || null; }

export function calculateMetrics(plan, material){
  let placed=0, partArea=0, sheetArea=0;
  for(const sh of plan.sheets){
    sheetArea += sh.width*sh.height; placed += sh.items.length;
    for(const it of sh.items){
      const p=resolvePart(plan,it); if(!p)continue;
      partArea += Math.max(0,contourInfo(p).area);
    }
  }
  const waste=Math.max(0,sheetArea-partArea);
  return {sheets:plan.sheets.length,placed,total:plan.totalParts,notPlaced:Math.max(0,plan.totalParts-placed),
    utilization:sheetArea?partArea/sheetArea*100:0,wasteM2:waste/1e6,sheetsM2:sheetArea/1e6,
    partWeight:partArea/1e6*(plan.thickness/1000)*material.density,
    sheetWeight:sheetArea/1e6*(plan.thickness/1000)*material.density};
}

export function makeBom(plan){
  const map=new Map();
  for(const sh of plan.sheets) for(const it of sh.items){
    const p=plan.partMap.get(it.instanceId); if(!p)continue;
    const key=p.id;
    if(!map.has(key))map.set(key,{id:p.id,name:p.name,ordered:p.quantity,placed:0,width:contourInfo(p).width,height:contourInfo(p).height});
    map.get(key).placed++;
  }
  for(const p of plan.originalParts) if(!map.has(p.id)) map.set(p.id,{id:p.id,name:p.name,ordered:p.quantity,placed:0,width:contourInfo(p).width,height:contourInfo(p).height});
  return [...map.values()];
}

function clipperPathsForPlan(plan, sheet){
  if(!window.ClipperLib)return null;
  const scale=10000, subj=[], bp=[{X:0,Y:0},{X:sheet.width*scale,Y:0},{X:sheet.width*scale,Y:sheet.height*scale},{X:0,Y:sheet.height*scale}];
  for(const it of sheet.items){
    const p=plan.partMap.get(it.instanceId); if(!p)continue;
    const loops=transformLoops(p.geometry.loops,it.rotation,it.x,it.y);
    for(const loop of loops) subj.push(loop.map(q=>({X:Math.round(q.x*scale),Y:Math.round(q.y*scale)})));
  }
  const out=new window.ClipperLib.Paths(), clip=new window.ClipperLib.Clipper();
  clip.AddPath(bp,window.ClipperLib.PolyType.ptSubject,true);
  if(subj.length) clip.AddPaths(subj,window.ClipperLib.PolyType.ptClip,true);
  const ok=clip.Execute(window.ClipperLib.ClipType.ctDifference,out,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftEvenOdd);
  if(!ok)return null;
  return out.map(poly=>poly.map(q=>({x:q.X/scale,y:q.Y/scale}))).filter(x=>x.length>=3);
}

export function calculateRemnants(plan,minArea=10000){
  const remnants=[];
  plan.sheets.forEach((sh,idx)=>{
    const paths=clipperPathsForPlan(plan,sh);
    if(!paths)return;
    paths.sort((a,b)=>{
      const ar=window.ClipperLib.Clipper.Area(a.map(p=>({X:p.x*10000,Y:p.y*10000})));
      const br=window.ClipperLib.Clipper.Area(b.map(p=>({X:p.x*10000,Y:p.y*10000})));
      return Math.abs(br)-Math.abs(ar);
    });
    for(const poly of paths.slice(0,6)){
      const ar=Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0)/2);
      if(ar>=minArea) remnants.push({id:crypto.randomUUID(),sheet:idx+1,area:ar,loops:[poly],width:loopsBounds([poly]).width,height:loopsBounds([poly]).height});
    }
  });
  return remnants;
}
