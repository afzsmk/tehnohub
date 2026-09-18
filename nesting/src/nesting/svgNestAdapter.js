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
  const timeout=Math.max(400,Number(opts.timeLimitMs||config.timeLimitMs||1800));
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
    const finish=()=>{if(finished)return;finished=true;try{window.SvgNest.stop();}catch{}resolve(best||{sheets:[],placedIds:[],rendered:[]});};
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
              items.push({instanceId:id,x:tr.x+edge,y:tr.y+edge,rotation:tr.rotation});
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
