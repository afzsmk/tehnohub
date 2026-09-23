export const MATERIALS = [
  { id:"steel-s235", name:"Сталь S235", density:7850 },
  { id:"steel-s355", name:"Сталь S355", density:7850 },
  { id:"stainless-304", name:"Нержавеющая сталь 304", density:7900 },
  { id:"galv", name:"Оцинкованная сталь", density:7850 },
  { id:"aluminum", name:"Алюминий", density:2700 },
  { id:"copper", name:"Медь", density:8900 },
  { id:"brass", name:"Латунь", density:8500 },
  { id:"plywood", name:"Фанера берёзовая", density:700 },
  { id:"mdf", name:"МДФ", density:800 },
  { id:"acrylic", name:"Акрил", density:1190 }
];

export const TECHNOLOGIES = [
  { id:"laser", name:"Лазер", spacing:1.5, edge:5, kerf:0.15 },
  { id:"plasma", name:"Плазма", spacing:2.5, edge:8, kerf:1.2 },
  { id:"waterjet", name:"Гидроабразив", spacing:1.5, edge:5, kerf:0.8 },
  { id:"router", name:"Фрезер", spacing:3, edge:10, kerf:3 }
];

export function createDefaultState(){
  return {
    job:{ name:"Новый раскрой", materialId:"steel-s235", thickness:3, technologyId:"laser" },
    nesting:{ spacing:1.5, edge:5, curveTolerance:0.35, rotations:4, populationSize:14, mutationRate:10,
      timeLimitMs:1800, useHoles:true, exploreConcave:true, allowMirror:false, strategy:"balanced" },
    sheets:[
      { id:crypto.randomUUID(), name:"Лист 2000×1250", width:2000, height:1250, qty:5, priority:1, source:"stock" }
    ],
    parts:[],
    remnants:[],
    options:{ maxVariants:3, minRemnant:100 }
  };
}

export function expandParts(parts){
  const out=[];
  for(const part of parts){
    const q=Math.max(0, Math.min(1000, Math.round(Number(part.quantity)||0)));
    for(let i=0;i<q;i++) out.push({ ...part, originalPartId:part.id, id:part.id+"#"+(i+1), instanceId:part.id+"#"+(i+1), instanceNo:i+1 });
  }
  return out;
}

export function totalQuantity(parts){ return parts.reduce((a,p)=>a+Math.max(0,Math.round(Number(p.quantity)||0)),0); }

export function clone(value){ return typeof structuredClone==="function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }


export function polygon(points, meta={}) {
  return { id:crypto.randomUUID(), name:meta.name||"Деталь", quantity:Math.max(1,Math.round(meta.quantity||1)), source:meta.source||"preset",
    geometry:{ loops:[points], loopDepths:[0] } };
}
export function circlePart(radius, meta={}) {
  const pts=[]; const n=96; for(let i=0;i<n;i++){const t=i*2*Math.PI/n;pts.push({x:radius*Math.cos(t)+radius,y:radius*Math.sin(t)+radius})}
  return polygon(pts,{...meta,name:meta.name||"Круг"});
}
export function ellipsePart(rx,ry,meta={}) {
  const pts=[]; const n=96; for(let i=0;i<n;i++){const t=i*2*Math.PI/n;pts.push({x:rx*Math.cos(t)+rx,y:ry*Math.sin(t)+ry})}
  return polygon(pts,{...meta,name:meta.name||"Эллипс"});
}
export function ringPart(outerR,innerR,meta={}) {
  const outer=[],inner=[]; const n=96;
  for(let i=0;i<n;i++){const t=i*2*Math.PI/n;outer.push({x:outerR*Math.cos(t)+outerR,y:outerR*Math.sin(t)+outerR});inner.push({x:innerR*Math.cos(2*Math.PI-t)+outerR,y:innerR*Math.sin(2*Math.PI-t)+outerR})}
  return { id:crypto.randomUUID(), name:meta.name||"Кольцо", quantity:Math.max(1,Math.round(meta.quantity||1)), source:"preset", geometry:{loops:[outer,inner],loopDepths:[0,1]} };
}
export function trianglePart(width,height,meta={}) {
  return polygon([{x:0,y:height},{x:width/2,y:0},{x:width,y:height}],{...meta,name:meta.name||"Треугольник"});
}
export function hexagonPart(radius,meta={}) {
  const pts=[]; const n=6; for(let i=0;i<n;i++){const t=Math.PI/6+i*2*Math.PI/n;pts.push({x:radius*Math.cos(t)+radius,y:radius*Math.sin(t)+radius})}
  return polygon(pts,{...meta,name:meta.name||"Шестиугольник"});
}
export function trapezoidPart(top,bottom,height,meta={}) {
  const dx=(bottom-top)/2; return polygon([{x:dx,y:height},{x:dx+top,y:height},{x:bottom,y:0},{x:0,y:0}],{...meta,name:meta.name||"Трапеция"});
}
export function lPart(width,height,leg,meta={}) {
  const a=Math.min(leg,width),b=Math.min(leg,height);
  return polygon([{x:0,y:0},{x:width,y:0},{x:width,y:b},{x:a,y:b},{x:a,y:height},{x:0,y:height}],{...meta,name:meta.name||"Г-образная"});
}
