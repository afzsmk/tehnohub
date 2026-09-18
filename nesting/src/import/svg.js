import { groupLoopsIntoParts, normalizeLoops } from "../geometry/geometry.js";
function svgUnitMm(value){ const m=String(value||"").trim().match(/^([0-9.+-eE]+)\s*(mm|cm|in|pt|px)?$/i); if(!m)return null; const n=Number(m[1]); if(!Number.isFinite(n))return null; const u=(m[2]||"").toLowerCase(); return n*(u==="in"?25.4:u==="cm"?10:u==="pt"?25.4/72:u==="px"?25.4/96:1); }

export function importSvg(text, fileName="design.svg"){
  if(!window.SvgNest || !window.SvgParser) throw new Error("SVG engine не загружен");
  const root=window.SvgNest.parsesvg(text);
  const loops=[];
  const names=[];
  for(const el of Array.from(root.childNodes||[])){
    if(!el.tagName) continue;
    const p=window.SvgParser.polygonify(el);
    if(p?.length>=3){ loops.push(p); names.push(el.getAttribute("data-name")||el.getAttribute("id")||""); }
  }
  if(!loops.length) throw new Error("В SVG не найдено замкнутых контуров");
  const warnings=[];
  const vb=(root.getAttribute("viewBox")||"").trim().split(/[ ,]+/).map(Number);
  let factor=1;
  const physicalW=svgUnitMm(root.getAttribute("width")), physicalH=svgUnitMm(root.getAttribute("height"));
  if(vb.length===4 && vb[2]>0 && vb[3]>0 && physicalW && physicalH){
    const fx=physicalW/vb[2], fy=physicalH/vb[3];
    if(Math.abs(fx-fy)/Math.max(fx,fy)<0.001) factor=fx;
    else warnings.push("SVG имеет неодинаковый масштаб X/Y; сохранены user units");
  }
  if(Math.abs(factor-1)>1e-9) for(let i=0;i<loops.length;i++) loops[i]=loops[i].map(p=>({x:p.x*factor,y:p.y*factor}));
  const parts=groupLoopsIntoParts(loops,{name:(fileName.replace(/\.[^.]+$/,"")||"Импорт SVG"),source:"svg"});
  parts.forEach((p,i)=>{ p.name=names[i]||p.name; p.sourceFile=fileName; });
  return {parts,warnings,units:"mm",unitFactor:factor};
}
