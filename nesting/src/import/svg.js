import { groupLoopsIntoParts, normalizeLoops } from "../geometry/geometry.js";

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
  const parts=groupLoopsIntoParts(loops,{name:(fileName.replace(/\.[^.]+$/,"")||"Импорт SVG"),source:"svg"});
  parts.forEach((p,i)=>{ p.name=names[i]||p.name; p.sourceFile=fileName; });
  return {parts,warnings:[],units:"svg"};
}
