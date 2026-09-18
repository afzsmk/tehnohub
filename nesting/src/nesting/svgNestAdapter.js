import { loopsToPathD, transformLoops } from "../geometry/geometry.js";

function engineSvg(parts, bin){
  const maxSize=Math.max(bin.width||0,bin.height||0,1000);
  const spread=maxSize*3+10000;
  const all=[];
  const hashLoop = function(loop){
    let h=2166136261;
    for(const p of loop){
      const x=Math.round(p.x*100),y=Math.round(p.y*100);
      h^=x;h=Math.imul(h,16777619);h^=y;h=Math.imul(h,16777619);
    }
    return "g"+(h>>>0).toString(16);
  };
  const partTypeKey = function(part){
    return (part.geometry.loops||[]).map(hashLoop).join(";");
  };
  parts.forEach((part,idx)=>{
    const dx=idx*spread+100000;
    const loops=part.geometry.loops;
    loops.forEach((loop,li)=>{
      const moved=loop.map(p=>({x:p.x+dx,y:p.y}));
      all.push('<path d="'+escapeAttr("M "+moved.map(p=>p.x+" "+p.y).join(" L ")+" Z")+'" data-part-id="'+escapeAttr(part.instanceId||part.id)+'" data-loop-index="'+li+'" data-source-name="'+escapeAttr(part.name||"Деталь")+'" data-nest-key="'+escapeAttr(hashLoop(loop))+'" data-part-nest-key="'+escapeAttr(partTypeKey(part))+'"/>');
    });
  });
  const bp=[{x:0,y:0},{x:bin.width,y:0},{x:bin.width,y:bin.height},{x:0,y:bin.height}];
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+bin.width+' '+bin.height+'"><path class="nest-bin" d="'+escapeAttr(loopsToPathD([bp]))+'"/>'+all.join("")+'</svg>';
}
function escapeAttr(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

function parseTranslateRotate(t){
  const m=/translate\(\s*([-\d.eE+]+)[ ,]+([-\d.eE+]+)\s*\)\s*rotate\(\s*([-\d.eE+]+)/.exec(t||"");
  return m?{x:Number(m[1]),y:Number(m[2]),rotation:Number(m[3])}:{x:0,y:0,rotation:0};
}

export async function runNest(parts, bin, config={}, opts={}){
  if(!parts.length) return {sheets:[],placedIds:[],rendered:[]};
  const timeout=Math.max(2500,Number(opts.timeLimitMs||config.timeLimitMs||8000));
  const edge=Math.max(0,Number(config.edge||0));
  const innerBin={width:Math.max(1,bin.width-2*edge),height:Math.max(1,bin.height-2*edge)};
  const text=engineSvg(parts,innerBin);
  const root=window.SvgNest.parsesvg(text);
  const binEl=Array.from(root.childNodes).find(el=>el.tagName && el.tagName.toLowerCase()!=="style");
  window.SvgNest.setbin(binEl);
  window.SvgNest.config({
    spacing:Number(config.spacing||0),
    rotations:Math.max(1,Number(config.rotations||4)),
    populationSize:Math.max(4,Number(config.populationSize||12)),
    mutationRate:Math.max(1,Number(config.mutationRate||10)),
    curveTolerance:Number(config.curveTolerance||0.35),
    useHoles:!!config.useHoles,
    exploreConcave:!!config.exploreConcave
  });

  return await new Promise(resolve=>{
    let best=null, finished=false;
    const finish=()=>{if(finished)return;finished=true;try{window.SvgNest.stop();}catch{}if(best&&best.sheets?.length&&best.placedIds?.length===parts.length){resolve(best)}
      else {
        const fallback=fallbackPack(parts,bin,config);
        if(fallback.placedIds?.length===parts.length || !best?.sheets?.length) resolve(fallback);
        else resolve(best);
      }};
    const timer=setTimeout(finish,timeout);
    try{
      const started=window.SvgNest.start(
        ()=>{},
        (svglist)=>{
          if(finished||!svglist?.length)return;
          const sheets=[];
          const placedIds=[];
          for(let si=0;si<svglist.length;si++){
            const svg=svglist[si];
            const items=[];
            for(const g of Array.from(svg.children||[])){
              if((g.getAttribute("class")||"").includes("bin"))continue;
              const child=Array.from(g.children||[]).find(x=>x.getAttribute("data-part-id"));
              if(!child)continue;
              const id=child.getAttribute("data-part-id");
              const tr=parseTranslateRotate(g.getAttribute("transform"));
              const renderGroup='<g transform="translate('+((tr.x||0)+edge)+' '+((tr.y||0)+edge)+') rotate('+(tr.rotation||0)+')">'+Array.from(g.children||[]).map(function(el){return el.outerHTML}).join("")+'</g>';
              items.push({instanceId:id,x:tr.x+edge,y:tr.y+edge,rotation:tr.rotation,svgGroup:renderGroup});
              placedIds.push(id);
            }
            if(items.length) sheets.push({width:bin.width,height:bin.height,items});
          }
          if(sheets.length){
            best={sheets,placedIds:[...new Set(placedIds)],rendered:svglist};
            if(opts.stopOnFull!==false && best.placedIds.length===parts.length){ clearTimeout(timer); finish(); }
          }
        }
      );
      if(started===false){clearTimeout(timer);finish();return;}
    }catch(e){clearTimeout(timer);finish();return;}
    setTimeout(()=>{clearTimeout(timer);finish();},Math.max(timeout,450));
  });
}

export function scoreNest(result, partMap, bin){
  const placed=result.placedIds?.length||0;
  const area=result.sheets.reduce((a,s)=>a+s.width*s.height,0)||1;
  let used=0;
  for(const sheet of result.sheets) for(const it of sheet.items){
    const p=partMap.get(it.instanceId); if(!p)continue;
    used += Math.abs((p.geometry.loops||[]).reduce((sum,l,i)=>{
      let x=0; for(let k=0;k<l.length;k++){const a=l[k],b=l[(k+1)%l.length];x+=a.x*b.y-b.x*a.y;} return sum+(i%2?-Math.abs(x/2):Math.abs(x/2));
    },0));
  }
  const util=used/area;
  return placed*1000000 + util*10000 - result.sheets.length*1000;
}


function rotatedBounds(loops,deg){
  const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const loop of loops) for(const p of loop){const x=p.x*c-p.y*s,y=p.x*s+p.y*c;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
}
function intersectionExists(a,b){
  if(!window.ClipperLib)return false;
  const scale=1000,toClip=function(poly){return poly.map(function(p){return {X:Math.round(p.x*scale),Y:Math.round(p.y*scale)}})};
  const c=new window.ClipperLib.Clipper(),out=new window.ClipperLib.Paths();
  c.AddPath(toClip(a),window.ClipperLib.PolyType.ptSubject,true);
  c.AddPath(toClip(b),window.ClipperLib.PolyType.ptClip,true);
  if(!c.Execute(window.ClipperLib.ClipType.ctIntersection,out,window.ClipperLib.PolyFillType.pftNonZero,window.ClipperLib.PolyFillType.pftNonZero))return false;
  return out.some(function(poly){return Math.abs(window.ClipperLib.Clipper.Area(poly))>1});
}
function fallbackPack(parts,bin,config){
  const edge=Math.max(0,Number(config.edge)||0),gap=Math.max(0,Number(config.spacing)||0);
  const availW=bin.width-2*edge,availH=bin.height-2*edge;
  const rotations=Math.max(1,Math.round(config.rotations||4)),step=360/rotations;
  const ordered=parts.slice().sort(function(a,b){
    const aa=rotatedBounds(a.geometry.loops,0),bb=rotatedBounds(b.geometry.loops,0);
    return bb.width*bb.height-aa.width*aa.height;
  });
  const placed=[],outerPlaced=[];
  for(const part of ordered){
    const rotationsForPart=[];
    for(let i=0;i<rotations;i++) rotationsForPart.push(Math.round(i*step*1000)/1000);
    let best=null;
    for(const rot of rotationsForPart){
      const rb=rotatedBounds(part.geometry.loops,rot);
      if(rb.width>availW+1e-6||rb.height>availH+1e-6)continue;
      const candidates=[{x:edge-rb.minX,y:edge-rb.minY}];
      for(const q of outerPlaced){
        const b=q.bounds;
        candidates.push({x:edge+b.maxX+gap-rb.minX,y:edge+b.minY-rb.minY});
        candidates.push({x:edge+b.minX-rb.minX,y:edge+b.maxY+gap-rb.minY});
        candidates.push({x:edge+b.maxX+gap-rb.minX,y:edge+b.maxY+gap-rb.minY});
      }
      const seen=new Set();
      for(const pos of candidates){
        const key=pos.x.toFixed(3)+"|"+pos.y.toFixed(3)+"|"+rot;
        if(seen.has(key))continue;seen.add(key);
        const minX=rb.minX+pos.x,maxX=rb.maxX+pos.x,minY=rb.minY+pos.y,maxY=rb.maxY+pos.y;
        if(minX<edge-1e-6||minY<edge-1e-6||maxX>bin.width-edge+1e-6||maxY>bin.height-edge+1e-6)continue;
        const loops=transformLoops(part.geometry.loops,rot,pos.x,pos.y);
        const outer=loops[0];
        let clash=false;
        for(const q of outerPlaced){if(intersectionExists(outer,q.outer)){clash=true;break}}
        if(clash)continue;
        const score=(maxY*100000)+maxX+(rb.width*0.1);
        if(!best||score<best.score)best={rot,pos,rb,outer,score};
      }
    }
    if(!best)return {sheets:[],placedIds:[],fallback:true};
    const item={instanceId:part.instanceId||part.id,x:best.pos.x,y:best.pos.y,rotation:best.rot};
    placed.push(item);
    outerPlaced.push({outer:best.outer,bounds:{minX:best.rb.minX+best.pos.x,maxX:best.rb.maxX+best.pos.x,minY:best.rb.minY+best.pos.y,maxY:best.rb.maxY+best.pos.y}});
  }
  return placed.length?{sheets:[{width:bin.width,height:bin.height,items:placed}],placedIds:placed.map(function(i){return i.instanceId}),fallback:true}:{sheets:[],placedIds:[],fallback:true};
}
