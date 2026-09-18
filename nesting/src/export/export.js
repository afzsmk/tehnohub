import { loopsToPathD, transformLoops, contourInfo } from "../geometry/geometry.js";
import { makeBom } from "../production/production.js";

export function download(name,blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);}
export function planToSvg(plan){
  const gap=80, totalH=plan.sheets.reduce((a,s)=>a+s.height+gap, -gap);
  let yoff=0, body="";
  plan.sheets.forEach((sh,si)=>{
    body+='<g transform="translate(0 '+yoff+')"><rect width="'+sh.width+'" height="'+sh.height+'" fill="none" stroke="#64748b" stroke-width="2"/>';
    for(const it of sh.items){const p=plan.partMap.get(it.instanceId);if(!p)continue;for(const loop of transformLoops(p.geometry.loops,it.rotation,it.x,it.y))body+='<path d="'+loopsToPathD([loop]).replace(/"/g,"&quot;")+'" fill="none" stroke="#111827" stroke-width="1.2" data-part-id="'+it.instanceId+'"/>'; }
    body+="</g>";yoff+=sh.height+gap;
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+Math.max(1,...plan.sheets.map(s=>s.width))+' '+Math.max(1,totalH)+'">'+body+"</svg>";
}
function dxfPath(arr,layer){let out=[];const pts=arr;for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];out.push("0","LINE","8",layer,"10",a.x.toFixed(3),"20",a.y.toFixed(3),"30","0","11",b.x.toFixed(3),"21",b.y.toFixed(3),"31","0");}return out;}
export function planToDxf(plan){
  const layers=new Set(["SHEET"]);
  const entities=[]; let yoff=0, extX=0,extY=0;
  plan.sheets.forEach((sh,si)=>{
    entities.push(...dxfPath([{x:0,y:yoff},{x:sh.width,y:yoff},{x:sh.width,y:yoff+sh.height},{x:0,y:yoff+sh.height}],"SHEET_"+(si+1)));
    layers.add("SHEET_"+(si+1));
    for(const it of sh.items){const p=plan.partMap.get(it.instanceId);if(!p)continue;const lname=("CUT_"+String(p.name||"PART").replace(/[^\w\-А-Яа-я]/g,"_").slice(0,24)).toUpperCase();layers.add(lname);for(const loop of transformLoops(p.geometry.loops,it.rotation,it.x,it.y).map(l=>l.map(q=>({x:q.x,y:q.y+yoff}))))entities.push(...dxfPath(loop,lname));}
    extX=Math.max(extX,sh.width);extY=yoff+sh.height;yoff+=sh.height+80;
  });
  const d=["0","SECTION","2","HEADER","9","$INSUNITS","70","4","9","$EXTMIN","10","0","20","0","30","0","9","$EXTMAX","10",String(extX),"20",String(extY),"30","0","0","ENDSEC","0","SECTION","2","TABLES","0","TABLE","2","LTYPE","70","1","0","LTYPE","2","CONTINUOUS","70","0","3","Solid line","72","65","73","0","40","0","0","ENDTAB","0","TABLE","2","LAYER","70",String(layers.size)];
  let color=1;for(const l of layers)d.push("0","LAYER","2",l,"70","0","62",String(color++%7+1),"6","CONTINUOUS");
  d.push("0","ENDTAB","0","ENDSEC","0","SECTION","2","ENTITIES",...entities,"0","ENDSEC","0","EOF");
  return d.join("\n");
}
export function planCsv(plan){const rows=[["Лист","Деталь","ID","X","Y","Угол","Ширина","Высота"]];for(let si=0;si<plan.sheets.length;si++)for(const it of plan.sheets[si].items){const p=plan.partMap.get(it.instanceId);rows.push([si+1,p?.name||"",it.instanceId,it.x.toFixed(2),it.y.toFixed(2),it.rotation.toFixed(1),p?contourInfo(p).width.toFixed(2):"",p?contourInfo(p).height.toFixed(2):""]);}return "\uFEFF"+rows.map(r=>r.join(";")).join("\r\n");}
export function planJson(plan){return JSON.stringify({...plan,partMap:undefined,originalParts:plan.originalParts},null,2);}
export function buildXlsx(plan){if(!window.XLSX)throw new Error("SheetJS не загружен");const wb=XLSX.utils.book_new(),bom=makeBom(plan);XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Деталь","Заказано","Размещено","Ширина","Высота"],...bom.map(p=>[p.name,p.ordered,p.placed,p.width,p.height])]),"Детали");XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Лист","Ширина","Высота","Деталей"],...plan.sheets.map((s,i)=>[i+1,s.width,s.height,s.items.length])]),"Листы");XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["Лист","Деталь","ID","X","Y","Угол"],...plan.sheets.flatMap((s,si)=>s.items.map(it=>[si+1,plan.partMap.get(it.instanceId)?.name||"",it.instanceId,it.x,it.y,it.rotation]))]),"Карта");return XLSX.write(wb,{bookType:"xlsx",type:"array"});}
