import { groupLoopsIntoParts } from "../geometry/geometry.js";

const PI=Math.PI;
const nnum=v=>Number(String(v??"").replace(",",".")); 
function pairs(text){ const a=text.replace(/\r/g,"").split("\n"); const p=[]; for(let i=0;i+1<a.length;i+=2){const code=Number(a[i].trim()); if(Number.isFinite(code))p.push({code,value:a[i+1].trim()});} return p; }
function unitFactor(code){ return ({1:25.4,2:304.8,3:1609344,4:1,5:10,6:1000,7:1000000}[code])||1; }
function readHeader(ps){ for(let i=0;i<ps.length-1;i++) if(ps[i].code===9&&ps[i].value==="$INSUNITS") return unitFactor(Number(ps[i+2]?.value||0)); return 1; }
function circle(cx,cy,r,n=72,start=0,end=2*PI){ const out=[]; for(let i=0;i<n;i++){const t=start+(end-start)*i/(n);out.push({x:cx+r*Math.cos(t),y:cy+r*Math.sin(t)});} return out; }
function bulgeArc(a,b,bulge,tol=0.75){
  if(Math.abs(bulge)<1e-8) return [a,b];
  const dx=b.x-a.x,dy=b.y-a.y,ch=Math.hypot(dx,dy),theta=4*Math.atan(bulge),r=Math.abs(ch/(2*Math.sin(theta/2)));
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,off=Math.sqrt(Math.max(0,r*r-ch*ch/4));
  const nx=-dy/ch,ny=dx/ch,sign=bulge>=0?1:-1;
  const cx=mx+nx*off*sign,cy=my+ny*off*sign;
  let t0=Math.atan2(a.y-cy,a.x-cx), t1=t0+theta;
  const steps=Math.max(2,Math.ceil(Math.abs(theta)*r/Math.max(tol,0.1)));
  const out=[a]; for(let i=1;i<steps;i++){const t=t0+(t1-t0)*i/steps;out.push({x:cx+r*Math.cos(t),y:cy+r*Math.sin(t)});} out.push(b); return out;
}
function lwpoly(records,scale){
  const verts=[]; let cur=null;
  for(const r of records){
    if(r.code===10){ if(cur)verts.push(cur); cur={x:nnum(r.value)*scale,y:0,bulge:0}; }
    else if(r.code===20&&cur)cur.y=nnum(r.value)*scale;
    else if(r.code===42&&cur)cur.bulge=nnum(r.value);
    else if(r.code===70&&!cur) {}
  }
  if(cur)verts.push(cur);
  let closed=records.find(r=>r.code===70)?.value; closed=(Number(closed||0)&1)===1;
  const out=[];
  for(let i=0;i<verts.length-1;i++) out.push(...bulgeArc({x:verts[i].x,y:verts[i].y},{x:verts[i+1].x,y:verts[i+1].y},verts[i].bulge));
  if(closed&&verts.length>2) out.push(...bulgeArc({x:verts.at(-1).x,y:verts.at(-1).y},{x:verts[0].x,y:verts[0].y},verts.at(-1).bulge));
  return {points:out.filter((p,i,a)=>i===0||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>1e-6),closed,layer:String(records.find(r=>r.code===8)?.value||"0")};
}
function ellipse(records,scale){
  const cx=nnum(records.find(r=>r.code===10)?.value)*scale, cy=nnum(records.find(r=>r.code===20)?.value)*scale;
  const mx=nnum(records.find(r=>r.code===11)?.value)*scale, my=nnum(records.find(r=>r.code===21)?.value)*scale;
  const ratio=nnum(records.find(r=>r.code===40)?.value)||1, start=nnum(records.find(r=>r.code===41)?.value)||0, end=nnum(records.find(r=>r.code===42)?.value) || 2*PI;
  const n=Math.max(24,Math.ceil(Math.abs(end-start)*Math.hypot(mx,my)/0.5));
  const out=[]; for(let i=0;i<n;i++){const t=start+(end-start)*i/(n-1),c=Math.cos(t),s=Math.sin(t);out.push({x:cx+mx*c-my*ratio*s,y:cy+my*c+mx*ratio*s});} return out;
}
function lineChain(segments,tol=0.01){
  const unused=segments.slice(), loops=[];
  const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=tol;
  while(unused.length){
    const seg=unused.pop(), path=[seg.a,seg.b]; let progress=true;
    while(progress){progress=false; for(let i=unused.length-1;i>=0;i--){const s=unused[i]; if(near(path.at(-1),s.a)){path.push(s.b);unused.splice(i,1);progress=true;break;} if(near(path.at(-1),s.b)){path.push(s.a);unused.splice(i,1);progress=true;break;} }}
    if(path.length>=3&&near(path[0],path.at(-1))) { path.pop(); loops.push(path); }
  }
  return loops;
}
export function importDxf(text,fileName="design.dxf"){
  const ps=pairs(text), scale=readHeader(ps), loops=[], warnings=[], layers=new Set(), segments=[];
  let ent=false;
  for(let i=0;i<ps.length;){
    if(ps[i].code===0&&ps[i].value==="SECTION"&&ps[i+1]?.code===2&&ps[i+1].value==="ENTITIES"){ent=true;i+=2;continue;}
    if(ent&&ps[i].code===0&&ps[i].value==="ENDSEC"){break;}
    if(!ent){i++;continue;}
    if(ps[i].code!==0){i++;continue;}
    const type=ps[i].value; let j=i+1; while(j<ps.length&&ps[j].code!==0)j++;
    const rec=ps.slice(i+1,j); const layer=String(rec.find(r=>r.code===8)?.value||"0"); layers.add(layer);
    const reject=/^(IGNORE|DEFPOINTS)$/i.test(layer), allowed=!reject;
    if(allowed && type==="LWPOLYLINE"){ const g=lwpoly(rec,scale); if(g.closed&&g.points.length>=3)loops.push(g.points); else warnings.push("Открытая LWPOLYLINE на слое "+layer); }
    else if(allowed&&type==="POLYLINE"){ const closed=(Number(rec.find(r=>r.code===70)?.value||0)&1)===1; const verts=[]; for(let k=j;k<ps.length&&ps[k].code!==0;k++){}; let k=j; while(k<ps.length&&!(ps[k].code===0&&ps[k].value==="SEQEND")){if(ps[k].code===0&&ps[k].value==="VERTEX"){let z=k+1;while(z<ps.length&&ps[z].code!==0)z++;const rr=ps.slice(k+1,z);verts.push({x:nnum(rr.find(r=>r.code===10)?.value)*scale,y:nnum(rr.find(r=>r.code===20)?.value)*scale});k=z;}else k++;} if(closed&&verts.length>=3)loops.push(verts); else warnings.push("Открытая POLYLINE на слое "+layer); }
    else if(allowed&&type==="LINE"){segments.push({a:{x:nnum(rec.find(r=>r.code===10)?.value)*scale,y:nnum(rec.find(r=>r.code===20)?.value)*scale},b:{x:nnum(rec.find(r=>r.code===11)?.value)*scale,y:nnum(rec.find(r=>r.code===21)?.value)*scale}});}
    else if(allowed&&type==="CIRCLE"){loops.push(circle(nnum(rec.find(r=>r.code===10)?.value)*scale,nnum(rec.find(r=>r.code===20)?.value)*scale,nnum(rec.find(r=>r.code===40)?.value)*scale));}
    else if(allowed&&type==="ARC"){const cx=nnum(rec.find(r=>r.code===10)?.value)*scale,cy=nnum(rec.find(r=>r.code===20)?.value)*scale,r=nnum(rec.find(r=>r.code===40)?.value)*scale;const a=nnum(rec.find(r=>r.code===50)?.value||0)*PI/180,b=nnum(rec.find(r=>r.code===51)?.value||360)*PI/180;let e=b;if(e<=a)e+=2*PI;const pts=circle(cx,cy,r,Math.max(16,Math.ceil((e-a)*r/0.5)),a,e);if(e-a>2*PI-1e-5)loops.push(pts);else for(let q=0;q<pts.length-1;q++)segments.push({a:pts[q],b:pts[q+1]});warnings.push("ARC на слое "+layer+" аппроксимирован и открытую дугу сшивает с соседними сегментами");}
    else if(allowed&&type==="ELLIPSE"){const pts=ellipse(rec,scale);const start=nnum(rec.find(r=>r.code===41)?.value)||0,end=nnum(rec.find(r=>r.code===42)?.value)||2*PI;if(end-start>=2*PI-1e-5)loops.push(pts);else for(let q=0;q<pts.length-1;q++)segments.push({a:pts[q],b:pts[q+1]});warnings.push("ELLIPSE на слое "+layer+" аппроксимирован полилинией");}
    else if(allowed&&type==="SPLINE")warnings.push("SPLINE не импортирован: сохраните как POLYLINE/LWPOLYLINE");
    i=j;
  }
  loops.push(...lineChain(segments,0.05*scale));
  if(!loops.length) throw new Error("В DXF не найдено замкнутых 2D-контуров");
  const parts=groupLoopsIntoParts(loops,{name:fileName.replace(/\.[^.]+$/,""),source:"dxf",layers:[...layers]});
  parts.forEach(p=>{p.sourceFile=fileName;p.dxfUnitsFactor=scale;});
  return {parts,warnings,units:"mm",unitFactor:scale,layers:[...layers]};
}
