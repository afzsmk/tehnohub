
import { createDefaultState, MATERIALS, TECHNOLOGIES, expandParts, clone, totalQuantity, polygon, circlePart, ellipsePart, ringPart, trianglePart, hexagonPart, trapezoidPart, lPart } from "./core/model.js";
import { contourInfo, loopsBounds, loopsToPathD, transformLoops } from "./geometry/geometry.js";
import { validatePart } from "./geometry/validation.js";
import { importSvg } from "./import/svg.js";
import { importDxf } from "./import/dxf.js";
import { parsePartsCsv } from "./import/csv.js";
import { runNest } from "./nesting/svgNestAdapter.js";
import { calculateMetrics, calculateRemnants, makeBom } from "./production/production.js";
import { download, planToSvg, planToDxf, planCsv, buildXlsx } from "./export/export.js";

const KEY="tehnohub.nesting.v2";
let state=load();
let currentPlan=null, running=false, mapZoom=1;

function $(id){return document.getElementById(id)}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function load(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY)||"null");
    if(x&&x.job){
      if(x.nesting && Number(x.nesting.timeLimitMs)===1800) x.nesting.timeLimitMs=8000;
      return x;
    }
    return createDefaultState();
  }catch(e){return createDefaultState()}
}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function fmt(n,d){return Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:d==null?1:d,minimumFractionDigits:d==null?1:d})}
function fmt0(n){return Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:0})}
function toast(msg,type){const t=$("toast");t.textContent=msg;t.className="toast "+(type||"ok");t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("show")},3500)}
function setBusy(on,msg){running=on;$("busy").classList.toggle("hidden",!on);$("busy-text").textContent=msg||"Расчёт...";$("run").disabled=on;$("compare").disabled=on}
function mat(){return MATERIALS.find(function(x){return x.id===state.job.materialId})||MATERIALS[0]}
function tech(){return TECHNOLOGIES.find(function(x){return x.id===state.job.technologyId})||TECHNOLOGIES[0]}

function initControls(){
  $("material").innerHTML=MATERIALS.map(function(m){return '<option value="'+m.id+'">'+esc(m.name)+" · "+m.density+" кг/м³</option>"}).join("");
  $("technology").innerHTML=TECHNOLOGIES.map(function(t){return '<option value="'+t.id+'">'+esc(t.name)+"</option>"}).join("");
  $("material").value=state.job.materialId;$("technology").value=state.job.technologyId;$("thickness").value=state.job.thickness;
  $("job-name").value=state.job.name;
  $("spacing").value=state.nesting.spacing;$("edge").value=state.nesting.edge;$("tolerance").value=state.nesting.curveTolerance;
  $("rotations").value=state.nesting.rotations;$("population").value=state.nesting.populationSize;$("mutation").value=state.nesting.mutationRate;
  $("timeLimit").value=Math.max(.4,state.nesting.timeLimitMs/1000);$("holes").checked=state.nesting.useHoles;$("concave").checked=state.nesting.exploreConcave;$("mirror").checked=state.nesting.allowMirror;
  renderSheets();renderParts();renderRemnants();renderSummary();
}
function renderSheets(){
  var html="";
  state.sheets.forEach(function(s,i){
    html+='<div class="sheet-item"><div class="sheet-top"><input data-s="'+i+'" data-k="name" value="'+esc(s.name||"Лист")+'" class="cell sheet-name" title="Наименование листа"><button class="icon-btn" data-remove-sheet="'+i+'">×</button></div><div class="sheet-fields"><label><span>Ширина, мм</span><input data-s="'+i+'" data-k="width" type="number" value="'+s.width+'" class="cell num"></label><label><span>Высота, мм</span><input data-s="'+i+'" data-k="height" type="number" value="'+s.height+'" class="cell num"></label><label><span>Количество</span><input data-s="'+i+'" data-k="qty" type="number" min="0" value="'+s.qty+'" class="cell num"></label><label><span>Приоритет</span><input data-s="'+i+'" data-k="priority" type="number" min="1" value="'+s.priority+'" class="cell num"></label></div></div>';
  });
  $("sheet-body").innerHTML=html||'<div class="empty-row">Добавьте хотя бы один формат листа.</div>';
  $("sheet-body").querySelectorAll("[data-s]").forEach(function(el){el.addEventListener("change",function(e){var i=+e.target.dataset.s,k=e.target.dataset.k;state.sheets[i][k]=e.target.type==="number"?Number(e.target.value):e.target.value;save();renderSummary()})});
  $("sheet-body").querySelectorAll("[data-remove-sheet]").forEach(function(el){el.onclick=function(){state.sheets.splice(+el.dataset.removeSheet,1);save();renderSheets();renderSummary()}});
}
function preview(part){
  var inf=contourInfo(part);return '<div class="mini-preview"><svg viewBox="0 0 '+Math.max(inf.width,1)+" "+Math.max(inf.height,1)+'">'+(part.geometry.loops||[]).map(function(l,i){return '<path d="'+loopsToPathD([l])+'" class="'+(i%2?"hole":"")+'"/>'}).join("")+"</svg></div>";
}
function renderParts(){
  if(!state.parts.length){$("parts-body").innerHTML='<tr><td colspan="5" class="empty-row">Добавьте DXF/SVG или стандартную фигуру.</td></tr>';return}
  $("parts-body").innerHTML=state.parts.map(function(p,i){var inf=contourInfo(p);return '<tr><td>'+preview(p)+'</td><td><input data-p="'+i+'" data-k="name" value="'+esc(p.name)+'" class="cell part-name"></td><td class="dim">'+fmt0(inf.width)+"×"+fmt0(inf.height)+'</td><td><input data-p="'+i+'" data-k="quantity" type="number" min="1" value="'+p.quantity+'" class="cell num part-qty"></td><td><button class="icon-btn" data-remove-part="'+i+'">×</button></td></tr>'}).join("");
  $("parts-body").querySelectorAll("[data-p]").forEach(function(el){el.addEventListener("change",function(e){var p=state.parts[+e.target.dataset.p],k=e.target.dataset.k;p[k]=e.target.type==="number"?Math.max(1,Math.round(Number(e.target.value)||1)):e.target.value;save();renderParts();renderSummary()})});
  $("parts-body").querySelectorAll("[data-remove-part]").forEach(function(el){el.onclick=function(){state.parts.splice(+el.dataset.removePart,1);save();renderParts();renderSummary()}});
}
function renderRemnants(){
  var a=state.remnants||[];
  $("remnants").innerHTML=a.length?a.map(function(r,i){return '<div class="rem-item"><div><b>'+fmt0(r.width)+"×"+fmt0(r.height)+' мм</b><span>'+esc(r.materialName||mat().name)+" · "+fmt(r.area/1e6,3)+' м²</span></div><button class="small-btn" data-use-rem="'+i+'">Добавить как заготовку</button></div>'}).join(""):'<div class="muted">Сохранённых остатков пока нет.</div>';
  $("remnants").querySelectorAll("[data-use-rem]").forEach(function(b){b.onclick=function(){var r=a[+b.dataset.useRem];var bb=loopsBounds(r.loops);var nearlyRect=Math.abs((r.area||0)/(bb.width*bb.height)-1)<.015;if(!nearlyRect){toast("Нерегулярный остаток пока не добавляется как прямоугольный лист.","warn");return}state.sheets.push({id:crypto.randomUUID(),name:"Остаток "+fmt0(bb.width)+"×"+fmt0(bb.height),width:Math.round(bb.width),height:Math.round(bb.height),qty:1,priority:1,source:"remnant"});save();renderSheets();toast("Остаток добавлен в заготовки.")}});
}
function renderSummary(){$("part-count").textContent=fmt0(totalQuantity(state.parts));$("sheet-count").textContent=fmt0(state.sheets.reduce(function(a,s){return a+Math.max(0,Number(s.qty)||0)},0))}
function addPartPreset(kind){
  var p,name;
  if(kind==="rect"){var w=Math.max(1,Number(prompt("Ширина, мм","600"))||600),h=Math.max(1,Number(prompt("Высота, мм","400"))||400);name=prompt("Наименование","Прямоугольник")||"Прямоугольник";p=polygon([{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}],{name:name});}
  else if(kind==="square"){var s=Math.max(1,Number(prompt("Сторона, мм","400"))||400);p=polygon([{x:0,y:0},{x:s,y:0},{x:s,y:s},{x:0,y:s}],{name:"Квадрат"});}
  else if(kind==="circle"){p=circlePart(Math.max(1,Number(prompt("Радиус, мм","200"))||200));}
  else if(kind==="ellipse"){var rx=Math.max(1,Number(prompt("Полуось X, мм","300"))||300),ry=Math.max(1,Number(prompt("Полуось Y, мм","150"))||150);p=ellipsePart(rx,ry);}
  else if(kind==="ring"){var ro=Math.max(2,Number(prompt("Наружный радиус, мм","250"))||250),ri=Math.max(1,Number(prompt("Внутренний радиус, мм","100"))||100);if(ri>=ro){toast("Внутренний радиус должен быть меньше наружного.","error");return}p=ringPart(ro,ri);}
  else if(kind==="triangle"){var tw=Math.max(1,Number(prompt("Основание, мм","500"))||500),th=Math.max(1,Number(prompt("Высота, мм","400"))||400);p=trianglePart(tw,th);}
  else if(kind==="hex"){p=hexagonPart(Math.max(1,Number(prompt("Радиус описанной окружности, мм","250"))||250));}
  else if(kind==="trapezoid"){var top=Math.max(1,Number(prompt("Верхнее основание, мм","300"))||300),bottom=Math.max(top,Number(prompt("Нижнее основание, мм","600"))||600),hh=Math.max(1,Number(prompt("Высота, мм","400"))||400);p=trapezoidPart(top,bottom,hh);}
  else if(kind==="l"){var lw=Math.max(10,Number(prompt("Общая ширина, мм","600"))||600),lh=Math.max(10,Number(prompt("Общая высота, мм","600"))||600),leg=Math.max(5,Number(prompt("Ширина полки, мм","180"))||180);p=lPart(lw,lh,leg);}
  if(!p)return;
  p.id=crypto.randomUUID();p.quantity=1;p.source="preset";
  state.parts.push(p);save();renderParts();renderSummary();closePresetMenu();
}
function closePresetMenu(){var m=$("preset-menu");if(m)m.classList.add("hidden")}
function addManual(){addPartPreset("rect")}
async function importFiles(files){
  for(const f of Array.from(files||[])){try{
    var text=await f.text(),ext=f.name.split(".").pop().toLowerCase(),r;
    if(ext==="svg")r=importSvg(text,f.name);else if(ext==="dxf")r=importDxf(text,f.name);else if(ext==="csv"||ext==="txt")r={parts:parsePartsCsv(text),warnings:[]};else throw new Error("Поддерживаются SVG, DXF и CSV");
    var accepted=[];r.parts.forEach(function(p){var v=validatePart(p,state.nesting.curveTolerance);if(v.errors.length){v.errors.forEach(function(w){toast(f.name+": "+w,"error")})}else{accepted.push(p);v.warnings.forEach(function(w){toast((p.name||f.name)+": "+w,"warn")})}});state.parts.push.apply(state.parts,accepted);(r.warnings||[]).forEach(function(w){toast(f.name+": "+w,"warn")});toast(f.name+": импортировано деталей "+accepted.length);
  }catch(e){toast(f.name+": "+e.message,"error")}}
  save();renderParts();renderSummary();
}
function syncControls(){
  state.job.name=$("job-name").value.trim()||"Новый раскрой";state.job.materialId=$("material").value;state.job.technologyId=$("technology").value;state.job.thickness=Math.max(.01,Number($("thickness").value)||1);
  Object.assign(state.nesting,{spacing:Math.max(0,Number($("spacing").value)||0),edge:Math.max(0,Number($("edge").value)||0),curveTolerance:Math.max(.05,Number($("tolerance").value)||.35),rotations:Math.max(1,Math.round(Number($("rotations").value)||4)),populationSize:Math.max(4,Math.round(Number($("population").value)||14)),mutationRate:Math.max(1,Math.round(Number($("mutation").value)||10)),timeLimitMs:Math.max(400,Math.round((Number($("timeLimit").value)||1)*1000)),useHoles:$("holes").checked,exploreConcave:$("concave").checked,allowMirror:$("mirror").checked});
  save();
}
function buildInstanceMap(parts){return new Map(parts.map(function(p){return [p.instanceId,p]}))}
function partArea(part){return Math.max(0,contourInfo(part).area)}

async function buildPlan(strategy){
  syncControls();
  var original=state.parts,expanded=expandParts(original);
  if(!expanded.length)throw new Error("Нет деталей для раскроя");
  var pools=state.sheets.filter(function(s){return Number(s.qty)>0})
    .map(function(s){return Object.assign({},s)})
    .sort(function(a,b){return a.priority-b.priority||(b.width*b.height-a.width*a.height)});
  if(!pools.length)throw new Error("Нет доступных листов");

  var remaining=expanded.slice(),sheets=[],steps=0;
  var vars={
    fast:{populationSize:8,mutationRate:8,rotations:state.nesting.rotations},
    balanced:{populationSize:state.nesting.populationSize,mutationRate:state.nesting.mutationRate,rotations:state.nesting.rotations},
    dense:{populationSize:20,mutationRate:16,rotations:Math.max(8,state.nesting.rotations)}
  };
  var uniqueTypes=new Set(expanded.map(function(p){
    return JSON.stringify((p.geometry?.loops||[]).map(function(loop){
      return loop.map(function(q){return [Math.round(q.x*100),Math.round(q.y*100)]})
    }))
  })).size;
  var basePopulation=Math.max(6,Math.min(Number(state.nesting.populationSize||14),uniqueTypes<=3?8:uniqueTypes<=8?10:14));
  var cfg=Object.assign({},state.nesting,vars[strategy||"balanced"],{
    spacing:state.nesting.spacing+Math.max(0,Number(tech().kerf)||0),
    populationSize:basePopulation,
    stopOnFull:strategy!=="dense",
    maxBins:1
  });

  while(remaining.length&&steps<200){
    var best=null;
    var available=pools.filter(function(s){return s.qty>0});
    if(!available.length)break;

    for(const pool of available){
      if(running)$("busy-text").textContent="Поиск раскладки: лист "+(steps+1)+" · проверка "+pool.width+"×"+pool.height+" · осталось деталей "+remaining.length;
      var result=await runNest(
        remaining,
        {width:pool.width,height:pool.height},
        cfg,
        {timeLimitMs:cfg.timeLimitMs,stopOnFull:cfg.stopOnFull}
      );
      var sheet=result.sheets&&result.sheets[0];
      if(!sheet||!sheet.items||!sheet.items.length)continue;

      var ids=new Set(sheet.items.map(function(x){return x.instanceId}));
      var placed=ids.size;
      var area=sheet.items.reduce(function(sum,it){
        var p=expanded.find(function(x){return x.instanceId===it.instanceId});
        return sum+(p?partArea(p):0);
      },0);
      var utilization=area/Math.max(1,pool.width*pool.height);
      var score=placed*1000000+utilization*100000-pool.priority*1000;
      if(!best||score>best.score)best={pool:pool,sheet:Object.assign({},sheet,{width:pool.width,height:pool.height,name:pool.name,source:pool.source||"stock"}),ids:ids,score:score};
    }

    if(!best)break;
    sheets.push(best.sheet);
    remaining=remaining.filter(function(p){return !best.ids.has(p.instanceId)});
    best.pool.qty-=1;
    steps++;
  }

  var map=buildInstanceMap(expanded);
  var plan={job:clone(state.job),thickness:state.job.thickness,totalParts:expanded.length,sheets:sheets,remaining:remaining,partMap:map,originalParts:original,remnants:[],strategy:strategy};
  plan.metrics=calculateMetrics(plan,mat());
  plan.remnants=calculateRemnants(plan,state.options.minRemnant*state.options.minRemnant);
  return plan;
}
function resolvePart(it){if(!currentPlan)return null;return currentPlan.partMap.get(it.instanceId)||currentPlan.partMap.get(String(it.instanceId||"").split("#")[0])||null}
function sheetKim(sh){var used=sh.items.reduce(function(a,it){var p=resolvePart(it);return a+(p?partArea(p):0)},0);return used/(sh.width*sh.height)*100}
function renderPlan(){
  if(!currentPlan){$("result").classList.add("hidden");$("result-empty").classList.remove("hidden");return}
  $("result").classList.remove("hidden");$("result-empty").classList.add("hidden");var m=currentPlan.metrics;
  $("metric-sheets").textContent=fmt0(m.sheets);$("metric-util").textContent=fmt(m.utilization,1)+"%";$("metric-placed").textContent=fmt0(m.placed)+" / "+fmt0(m.total);$("metric-waste").textContent=fmt(m.wasteM2,3)+" м²";$("metric-weight").textContent=fmt(m.partWeight,1)+" кг";$("metric-unplaced").textContent=fmt0(m.notPlaced);
  $("result-status").className="status "+(m.notPlaced?"warn":"ok");$("result-status").textContent=m.notPlaced?"Не размещено: "+m.notPlaced:"Все детали размещены";renderMaps();renderBom();renderResultRemnants();
}
function svgForSheet(sh){
  var parts=[];
  for(const it of sh.items){
    if(it.svgGroup) parts.push(it.svgGroup);
    else {var p=currentPlan.partMap.get(it.instanceId);if(!p)continue;transformLoops(p.geometry.loops,it.rotation,it.x,it.y).forEach(function(loop){parts.push('<path class="part-path" data-id="'+esc(it.instanceId)+'" d="'+loopsToPathD([loop])+'"/>')})}
  }
  return '<svg viewBox="0 0 '+sh.width+" "+sh.height+'" class="map-svg" style="width:'+mapZoom*100+'%"><rect class="sheet-box" width="'+sh.width+'" height="'+sh.height+'"/>'+parts.join("")+"</svg>";
}
function renderMaps(){$("maps").innerHTML=currentPlan.sheets.map(function(s,i){return '<article class="map-card"><div class="map-head"><div><b>Лист '+(i+1)+'</b><span>'+fmt0(s.width)+"×"+fmt0(s.height)+" мм · "+esc(s.name||"Заготовка")+'</span></div><span class="map-kim">'+fmt(sheetKim(s),1)+'%</span></div><div class="map-viewport">'+svgForSheet(s)+"</div></article>"}).join("")||'<div class="empty-block">Нет готовых карт.</div>'}
function renderBom(){$("bom").innerHTML=makeBom(currentPlan).map(function(r){return '<tr><td>'+esc(r.name)+'</td><td>'+fmt0(r.ordered)+'</td><td>'+fmt0(r.placed)+'</td><td>'+fmt0(r.width)+"×"+fmt0(r.height)+'</td><td>'+(r.placed<r.ordered?'<span class="bad">недостача</span>':'<span class="good">OK</span>')+'</td></tr>'}).join("")}
function renderResultRemnants(){$("result-remnants").innerHTML=(currentPlan.remnants||[]).length?currentPlan.remnants.map(function(r){return '<span class="rem-chip">'+fmt0(r.width)+"×"+fmt0(r.height)+" мм · "+fmt(r.area/1e6,3)+" м²</span>"}).join(""):'<span class="muted">Деловых остатков выше порога нет.</span>'}
function saveResultRemnants(){
  (currentPlan.remnants||[]).forEach(function(r){state.remnants.push(Object.assign({},r,{materialId:state.job.materialId,materialName:mat().name,thickness:state.job.thickness}))});save();renderRemnants();toast("Остатки сохранены в библиотеку.");
}
async function run(){
  if(running)return;try{setBusy(true,"Подготовка геометрии...");await new Promise(function(r){setTimeout(r,20)});currentPlan=await buildPlan(state.nesting.strategy);renderPlan();toast(currentPlan.metrics.notPlaced?"Раскладка готова, не размещено "+currentPlan.metrics.notPlaced:"Раскладка готова.")}catch(e){toast(e.message,"error")}finally{setBusy(false)}
}
async function compare(){
  if(running)return;if(!state.parts.length){toast("Нет деталей","error");return}
  try{
    setBusy(true,"Сравнение алгоритмов...");var out=[],strategies=[["Быстрый","fast"],["Сбалансированный","balanced"],["Плотный","dense"]];
    for(const s of strategies)out.push({label:s[0],key:s[1],plan:await buildPlan(s[1])});
    var best=out.slice().sort(function(a,b){return a.plan.metrics.notPlaced-b.plan.metrics.notPlaced||a.plan.metrics.sheets-b.plan.metrics.sheets||b.plan.metrics.utilization-a.plan.metrics.utilization})[0];
    currentPlan=best.plan;renderPlan();$("variants").innerHTML=out.map(function(x){return '<button class="variant '+(x.key===best.key?"active":"")+'" data-variant="'+x.key+'"><b>'+x.label+'</b><span>'+fmt(x.plan.metrics.utilization,1)+"% · "+x.plan.metrics.sheets+" листов · "+(x.plan.metrics.notPlaced?"не размещено "+x.plan.metrics.notPlaced:"все детали")+"</span></button>"}).join("");$("variants-panel").classList.remove("hidden");
    $("variants").querySelectorAll("[data-variant]").forEach(function(b){b.onclick=function(){var x=out.find(function(v){return v.key===b.dataset.variant});currentPlan=x.plan;renderPlan();$("variants").querySelectorAll(".variant").forEach(function(v){v.classList.toggle("active",v===b)})}});
  }catch(e){toast(e.message,"error")}finally{setBusy(false)}
}
function bind(){
  $("add-sheet").onclick=function(){state.sheets.push({id:crypto.randomUUID(),name:"Лист",width:2000,height:1250,qty:1,priority:1,source:"stock"});save();renderSheets();renderSummary()};
  $("add-part").onclick=function(e){e.stopPropagation();var m=$("preset-menu");m.classList.toggle("hidden")};
  $("preset-menu").querySelectorAll("[data-preset]").forEach(function(b){b.onclick=function(e){e.stopPropagation();addPartPreset(b.dataset.preset)}});$("file").onchange=function(e){importFiles(e.target.files);e.target.value=""};
  document.addEventListener("click",function(e){if(!e.target.closest("#add-part")&&!e.target.closest("#preset-menu"))closePresetMenu()});$("dropzone").ondragover=function(e){e.preventDefault();$("dropzone").classList.add("drag")};$("dropzone").ondragleave=function(){$("dropzone").classList.remove("drag")};$("dropzone").ondrop=function(e){e.preventDefault();$("dropzone").classList.remove("drag");importFiles(e.dataTransfer.files)};
  ["job-name","material","technology","thickness","spacing","edge","tolerance","rotations","population","mutation","timeLimit","holes","concave","mirror"].forEach(function(id){$(id).addEventListener("change",syncControls)});
  $("run").onclick=run;$("compare").onclick=compare;$("save-remnants").onclick=function(){if(currentPlan)saveResultRemnants()};
  $("export-svg").onclick=function(){if(currentPlan)download("nestcut-plan.svg",new Blob([planToSvg(currentPlan)],{type:"image/svg+xml"}))};
  $("export-dxf").onclick=function(){if(currentPlan)download("nestcut-plan.dxf",new Blob([planToDxf(currentPlan)],{type:"application/dxf"}))};
  $("export-csv").onclick=function(){if(currentPlan)download("nestcut-plan.csv",new Blob([planCsv(currentPlan)],{type:"text/csv;charset=utf-8"}))};
  $("export-xlsx").onclick=function(){try{if(currentPlan)download("nestcut-plan.xlsx",new Blob([buildXlsx(currentPlan)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}))}catch(e){toast(e.message,"error")}};
  $("export-json").onclick=function(){download("nestcut-job.json",new Blob([JSON.stringify({state:state,plan:currentPlan?Object.assign({},currentPlan,{partMap:undefined}):null},null,2)],{type:"application/json"}))};
  $("print").onclick=function(){window.print()};
  $("zoom-in").onclick=function(){mapZoom=Math.min(2.5,mapZoom*1.2);renderMaps()};$("zoom-out").onclick=function(){mapZoom=Math.max(.5,mapZoom/1.2);renderMaps()};$("zoom-fit").onclick=function(){mapZoom=1;renderMaps()};
  $("clear").onclick=function(){state=createDefaultState();currentPlan=null;save();initControls();renderPlan()};$("zoom-fit").onclick=function(){mapZoom=1;renderMaps()};
}
initControls();bind();
