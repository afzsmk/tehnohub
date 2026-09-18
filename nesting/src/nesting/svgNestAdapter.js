import { loopsToPathD, transformLoops } from "../geometry/geometry.js";

function engineSvg(parts, bin){
  const maxSize=Math.max(bin.width||0,bin.height||0,1000);
  const spread=maxSize*3+10000;
  const all=[];
  parts.forEach((part,idx)=>{
    const dx=idx*spread+100000;
    const loops=part.geometry.loops;
    loops.forEach((loop,li)=>{
      const moved=loop.map(p=>({x:p.x+dx,y:p.y}));
      all.push('<path d="'+escapeAttr("M "+moved.map(p=>p.x+" "+p.y).join(" L ")+" Z")+'" data-part-id="'+escapeAttr(part.instanceId||part.id)+'" data-loop-index="'+li+'" data-source-name="'+escapeAttr(part.name||"Деталь")+'"/>');
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
      window.SvgNest.start(
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
          if(sheets.length) best={sheets,placedIds:[...new Set(placedIds)],rendered:svglist};
        }
      );
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
  return {minX,minY,width:maxX-minX,height:maxY-minY};
}
function fallbackPack(parts,bin,config){
  const edge=Math.max(0,Number(config.edge)||0),gap=Math.max(0,Number(config.spacing)||0),availW=bin.width-2*edge,availH=bin.height-2*edge;
  const rotations=Math.max(1,Math.round(config.rotations||4));
  const used=[],out=[],step=360/rotations;
  let x=0,y=0,rowH=0;
  for(const part of parts){
    let best=null;
    for(let i=0;i<rotations;i++){
      const rot=Math.round(i*step*1000)/1000,b=rotatedBounds(part.geometry.loops,rot);
      if(b.width<=availW && b.height<=availH && (!best||b.width<best.b.width||(Math.abs(b.width-best.b.width)<1e-6&&b.height<best.b.height)))best={rot,b};
    }
    if(!best)return {sheets:[],placedIds:[],fallback:true};
    if(x>0 && x+best.b.width>availW){x=0;y+=rowH+gap;rowH=0;}
    if(y+best.b.height>availH)return {sheets:[],placedIds:[],fallback:true};
    const item={instanceId:part.instanceId||part.id,x:edge+x-best.b.minX,y:edge+y-best.b.minY,rotation:best.rot};
    used.push(item);x+=best.b.width+gap;rowH=Math.max(rowH,best.b.height);
  }
  return used.length?{sheets:[{width:bin.width,height:bin.height,items:used}],placedIds:used.map(i=>i.instanceId),fallback:true}:{sheets:[],placedIds:[],fallback:true};
}
