import { contourInfo, loopsBounds, transformLoops } from "../geometry/geometry.js";

function resolvePart(plan,it){
  return plan.partMap.get(it.instanceId) || plan.partMap.get(String(it.instanceId||"").split("#")[0]) || null;
}

export function calculateMetrics(plan, material){
  let placed=0, partArea=0, sheetArea=0;
  for(const sh of plan.sheets||[]){
    const sw=Math.max(0,Number(sh.width)||0), shh=Math.max(0,Number(sh.height)||0);
    sheetArea += sw*shh;
    placed += (sh.items||[]).length;
    for(const it of sh.items||[]){
      const p=resolvePart(plan,it);
      if(p) partArea += Math.max(0,Number(contourInfo(p).area)||0);
    }
  }
  const thicknessM=Math.max(0,Number(plan.thickness)||0)/1000;
  const density=Math.max(0,Number(material?.density)||0);
  const sheetWeight=sheetArea/1e6*thicknessM*density;
  const partWeight=partArea/1e6*thicknessM*density;
  const scrapArea=Math.max(0,sheetArea-partArea);
  const utilization=sheetArea>0?partArea/sheetArea*100:0;
  const scrapWeight=scrapArea/1e6*thicknessM*density;
  return {
    sheets:(plan.sheets||[]).length,
    placed,
    total:plan.totalParts||0,
    notPlaced:Math.max(0,(plan.totalParts||0)-placed),
    partAreaM2:partArea/1e6,
    sheetAreaM2:sheetArea/1e6,
    scrapAreaM2:scrapArea/1e6,
    utilization,
    wastePercent:Math.max(0,100-utilization),
    partWeight,
    sheetWeight,
    scrapWeight,
    totalMaterialWeight:sheetWeight
  };
}

export function makeBom(plan){
  const map=new Map();
  for(const sh of plan.sheets||[]) for(const it of sh.items||[]){
    const p=resolvePart(plan,it);
    if(!p)continue;
    const key=p.id||String(p.instanceId);
    if(!map.has(key)){
      const inf=contourInfo(p);
      map.set(key,{id:p.id,name:p.name,ordered:p.quantity,placed:0,width:inf.width,height:inf.height,area:Math.max(0,inf.area)});
    }
    map.get(key).placed++;
  }
  for(const p of plan.originalParts||[]){
    const key=p.id||String(p.instanceId);
    if(!map.has(key)){
      const inf=contourInfo(p);
      map.set(key,{id:p.id,name:p.name,ordered:p.quantity,placed:0,width:inf.width,height:inf.height,area:Math.max(0,inf.area)});
    }
  }
  return [...map.values()];
}

function leftoverPolygons(plan,sheet){
  if(!window.ClipperLib)return null;
  const scale=10000;
  const toClip=loop=>loop.map(q=>({X:Math.round(q.x*scale),Y:Math.round(q.y*scale)}));
  const subject=[{X:0,Y:0},{X:Math.round(sheet.width*scale),Y:0},{X:Math.round(sheet.width*scale),Y:Math.round(sheet.height*scale)},{X:0,Y:Math.round(sheet.height*scale)}];
  const clips=[];
  for(const it of sheet.items||[]){
    const p=resolvePart(plan,it);
    if(!p)continue;
    const loops=transformLoops(p.geometry.loops,it.rotation,it.x,it.y);
    const depths=p.geometry.loopDepths||loops.map((_,i)=>i===0?0:1);
    loops.forEach((loop,i)=>{if((depths[i]||0)%2===0)clips.push(toClip(loop));});
  }
  const c=new window.ClipperLib.Clipper(),unioned=new window.ClipperLib.Paths(),out=new window.ClipperLib.Paths();
  if(!clips.length)return [subject.map(q=>({x:q.X/scale,y:q.Y/scale}))];
  c.AddPaths(clips,window.ClipperLib.PolyType.ptSubject,true);
  c.Execute(window.ClipperLib.ClipType.ctUnion,unioned,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftNonZero);
  const d=new window.ClipperLib.Clipper();
  d.AddPath(subject,window.ClipperLib.PolyType.ptSubject,true);
  d.AddPaths(unioned,window.ClipperLib.PolyType.ptClip,true);
  const ok=d.Execute(window.ClipperLib.ClipType.ctDifference,out,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftNonZero);
  if(!ok)return null;
  return out.map(poly=>poly.map(q=>({x:q.X/scale,y:q.Y/scale}))).filter(poly=>poly.length>=3);
}

export function calculateRemnants(plan,minAreaM2=0.01){
  const remnants=[],minArea=Math.max(0.000001,Number(minAreaM2)||0.01)*1e6;
  (plan.sheets||[]).forEach((sheet,idx)=>{
    const paths=leftoverPolygons(plan,sheet); if(!paths)return;
    for(const poly of paths){
      const ar=Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p.x*q.y-q.x*p.y;},0)/2);
      const ratio=ar/Math.max(1,sheet.width*sheet.height);
      if(ar<minArea||ratio>0.985)continue;
      const bb=loopsBounds([poly]);
      remnants.push({id:crypto.randomUUID(),sheet:idx+1,area:ar,width:bb.width,height:bb.height,loops:[poly],
        utilization:bb.width*bb.height>0?ar/(bb.width*bb.height)*100:0,
        touchesEdge:Math.abs(bb.minX)<0.5||Math.abs(bb.minY)<0.5||Math.abs(bb.maxX-sheet.width)<0.5||Math.abs(bb.maxY-sheet.height)<0.5});
    }
  });
  return remnants.sort((a,b)=>b.area-a.area);
}

export function getRemnantSummary(plan){
  const items=plan.remnants||[];
  return {count:items.length,areaM2:items.reduce((s,r)=>s+r.area,0)/1e6};
}
