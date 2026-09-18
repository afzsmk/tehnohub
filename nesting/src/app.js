
import { createDefaultState, MATERIALS, TECHNOLOGIES, expandParts, clone, totalQuantity } from "./core/model.js";
import { contourInfo, loopsBounds, loopsToPathD, transformLoops } from "./geometry/geometry.js";
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
function load(){try{const x=JSON.parse(localStorage.getItem(KEY)||"null");return x&&x.job?x:createDefaultState()}catch(e){return createDefaultState()}}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function fmt(n,d){return Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:d==null?1:d,minimumFractionDigits:d==null?1:d})}
function fmt0(n){return Number(n||0).toLocaleString("ru-RU",{maximumFractionDigits:0})}
function toast(msg,type){const t=$("toast");t.textContent=msg;t.className="toast "+(type||"ok");t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove("show")},3500)}
function setBusy(on,msg){running=on;$("busy").classList.toggle("hidden",!on);$("busy-text").textContent=msg||"Расчёт...";$("run").disabled=on;$("compare").disabled=on}
function mat(){return MATERIALS.find(function(x){return x.id===state.job.materialId})||MATERIALS[0]}

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
  state.sheets.forEach(function(s,i){html+='<tr><td><input data-s="'+i+'" data-k="name" value="'+esc(s.name||"Лист")+'" class="cell"></td><td><input data-s="'+i+'" data-k="width" type="number" value="'+s.width+'" class="cell num"></td><td><input data-s="'+i+'" data-k="height" type="number" value="'+s.height+'" class="cell num"></td><td><input data-s="'+i+'" data-k="qty" type="number" min="0" value="'+s.qty+'" class="cell num"></td><td><input data-s="'+i+'" data-k="priority" type="number" min="1" value="'+s.priority+'" class="cell num"></td><td><button class="icon-btn" data-remove-sheet="'+i+'">×</button></td></tr>'});
  $("sheet-body").innerHTML=html;
  $("sheet-body").querySelectorAll("[data-s]").forEach(function(el){el.addEventListener("change",function(e){var i=+e.target.dataset.s,k=e.target.dataset.k;state.sheets[i][k]=e.target.type==="number"?Number(e.target.value):e.target.value;save()})});
  $("sheet-body").querySelectorAll("[data-remove-sheet]").forEach(function(el){el.onclick=function(){state.sheets.splice(+el.dataset.removeSheet,1);save();renderSheets();renderSummary()}});
}
function preview(part){
  var inf=contourInfo(part);return '<div class="mini-preview"><svg viewBox="0 0 '+Math.max(inf.width,1)+" "+Math.max(inf.height,1)+'">'+(part.geometry.loops||[]).map(function(l,i){return '<path d="'+loopsToPathD([l])+'" class="'+(i%2?"hole":"")+'"/>'}).join("")+"</svg></div>";
}
function renderParts(){
  if(!state.parts.length){$("parts-body").innerHTML='<tr><td colspan="6" class="empty-row">Добавьте DXF/SVG или прямоугольную деталь.</td></tr>';return}
  $("parts-body").innerHTML=state.parts.map(function(p,i){var inf=contourInfo(p);return '<tr><td>'+preview(p)+'</td><td><input data-p="'+i+'" data-k="name" value="'+esc(p.name)+'" class="cell"></td><td class="dim">'+fmt0(inf.width)+"×"+fmt0(inf.height)+'</td><td><input data-p="'+i+'" data-k="quantity" type="number" min="1" value="'+p.quantity+'" class="cell num"></td><td><span class="source">'+esc(p.source||"manual")+'</span></td><td><button class="icon-btn" data-remove-part="'+i+'">×</button></td></tr>'}).join("");
  $("parts-body").querySelectorAll("[data-p]").forEach(function(el){el.addEventListener("change",function(e){var p=state.parts[+e.target.dataset.p],k=e.target.dataset.k;p[k]=e.target.type==="number"?Math.max(1,Math.round(Number(e.target.value)||1)):e.target.value;save();renderParts()})});
  $("parts-body").querySelectorAll("[data-remove-part]").forEach(function(el){el.onclick=function(){state.parts.splice(+el.dataset.removePart,1);save();renderParts();renderSummary()}});
}
function renderRemnants(){
  var a=state.remnants||[];
  $("remnants").innerHTML=a.length?a.map(function(r,i){return '<div class="rem-item"><div><b>'+fmt0(r.width)+"×"+fmt0(r.height)+' мм</b><span>'+esc(r.materialName||mat().name)+" · "+fmt(r.area/1e6,3)+' м²</span></div><button class="small-btn" data-use-rem="'+i+'">Добавить как заготовку</button></div>'}).join(""):'<div class="muted">Сохранённых остатков пока нет.</div>';
  $("remnants").querySelectorAll("[data-use-rem]").forEach(function(b){b.onclick=function(){var r=a[+b.dataset.useRem];var bb=loopsBounds(r.loops);var nearlyRect=Math.abs((r.area||0)/(bb.width*bb.height)-1)<.015;if(!nearlyRect){toast("Нерегулярный остаток пока не добавляется как прямоугольный лист.","warn");return}state.sheets.push({id:crypto.randomUUID(),name:"Остаток "+fmt0(bb.width)+"×"+fmt0(bb.height),width:Math.round(bb.width),height:Math.round(bb.height),qty:1,priority:1,source:"remnant"});save();renderSheets();toast("Остаток добавлен в заготовки.")}});
}
function renderSummary(){$("part-count").textContent=fmt0(totalQuantity(state.parts));$("sheet-count").textContent=fmt0(state.sheets.reduce(function(a,s){return a+Math.max(0,Number(s.qty)||0)},0))}
function addManual(){
  var w=Math.max(1,Number(prompt("Ширина детали, мм","600"))||600),h=Math.max(1,Number(prompt("Высота детали, мм","400"))||400),name=prompt("Наименование","Новая деталь")||"Новая деталь";
  state.parts.push({id:crypto.randomUUID(),name:name,quantity:1,source:"manual",geometry:{loops:[[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]],loopDepths:[0]}});
  save();renderParts();renderSummary();
}
async function importFiles(files){
  for(const f of Array.from(files||[])){try{
    var text=await f.text(),ext=f.name.split(".").pop().toLowerCase(),r;
    if(ext==="svg")r=importSvg(text,f.name);else if(ext==="dxf")r=importDxf(text,f.name);else if(ext==="csv"||ext==="txt")r={parts:parsePartsCsv(text),warnings:[]};else throw new Error("Поддерживаются SVG, DXF и CSV");
    state.parts.push.apply(state.parts,r.parts);(r.warnings||[]).forEach(function(w){toast(f.name+": "+w,"warn")});toast(f.name+": импортировано деталей "+r.parts.length);
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
  syncControls();var original=state.parts,expanded=expandParts(original);if(!expanded.length)throw new Error("Нет деталей для раскроя");
  var pools=state.sheets.filter(function(s){return Number(s.qty)>0}).slice().sort(function(a,b){return a.priority-b.priority||(b.width*b.height-a.width*a.height)});if(!pools.length)throw new Error("Нет доступных листов");
  var remaining=expanded.slice(),sheets=[],steps=0;
  var vars={fast:{populationSize:8,mutationRate:8,rotations:state.nesting.rotations},balanced:{populationSize:state.nesting.populationSize,mutationRate:state.nesting.mutationRate,rotations:state.nesting.rotations},dense:{populationSize:20,mutationRate:16,rotations:Math.max(8,state.nesting.rotations)}};
  var cfg=Object.assign({},state.nesting,vars[strategy||"balanced"]);
  while(remaining.length&&steps<50){
    var best=null;
    for(const pool of pools.filter(function(s){return s.qty>0})){
      var r=await runNest(remaining,{width:pool.width,height:pool.height},cfg,{timeLimitMs:cfg.timeLimitMs});
      var capped=r.sheets.slice(0,Math.max(1,Math.round(pool.qty))),ids=new Set(capped.flatMap(function(s){return s.items.map(function(x){return x.instanceId})})),placed=ids.size;
      if(!placed)continue;
      var used=capped.length*pool.width*pool.height,score=placed*1000000-capped.length*20000+(placed/Math.max(1,used))*100000;
      if(!best||score>best.score)best={pool:pool,capped:capped,ids:ids,score:score};
    }
    if(!best)break;
    best.capped.forEach(function(s){sheets.push(Object.assign({},s,{name:best.pool.name,source:best.pool.source||"stock"}))});
    remaining=remaining.filter(function(p){return !best.ids.has(p.instanceId)});best.pool.qty-=best.capped.length;steps++;
    if(running)$("busy-text").textContent="Оптимизация: размещено "+(expanded.length-remaining.length)+" из "+expanded.length;
  }
  var map=buildInstanceMap(expanded),plan={job:clone(state.job),thickness:state.job.thickness,totalParts:expanded.length,sheets:sheets,remaining:remaining,partMap:map,originalParts:original,remnants:[],strategy:strategy};
  plan.metrics=calculateMetrics(plan,mat());plan.remnants=calculateRemnants(plan,state.options.minRemnant*state.options.minRemnant);return plan;
}
function sheetKim(sh){var used=sh.items.reduce(function(a,it){var p=currentPlan.partMap.get(it.instanceId);return a+(p?partArea(p):0)},0);return used/(sh.width*sh.height)*100}
function renderPlan(){
  if(!currentPlan){$("result").classList.add("hidden");return}
  $("result").classList.remove("hidden");var m=currentPlan.metrics;
  $("metric-sheets").textContent=fmt0(m.sheets);$("metric-util").textContent=fmt(m.utilization,1)+"%";$("metric-placed").textContent=fmt0(m.placed)+" / "+fmt0(m.total);$("metric-waste").textContent=fmt(m.wasteM2,3)+" м²";$("metric-weight").textContent=fmt(m.partWeight,1)+" кг";$("metric-unplaced").textContent=fmt0(m.notPlaced);
  $("result-status").className="status "+(m.notPlaced?"warn":"ok");$("result-status").textContent=m.notPlaced?"Не размещено: "+m.notPlaced:"Все детали размещены";renderMaps();renderBom();renderResultRemnants();
}
function svgForSheet(sh){
  var parts=[];for(const it of sh.items){var p=currentPlan.partMap.get(it.instanceId);if(!p)continue;transformLoops(p.geometry.loops,it.rotation,it.x,it.y).forEach(function(loop){parts.push('<path class="part-path" data-id="'+esc(it.instanceId)+'" d="'+loopsToPathD([loop])+'"/>')})}
  return '<svg viewBox="0 0 '+sh.width+" "+sh.height+'" class="map-svg" style="width:'+Math.max(420,Math.round(sh.width*mapZoom/1.2))+'px"><rect class="sheet-box" width="'+sh.width+'" height="'+sh.height+'"/>'+parts.join("")+"</svg>";
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
    var best=out.slice().sort(function(a,b){return b.plan.metrics.utilization-a.plan.metrics.utilization||a.plan.metrics.notPlaced-b.plan.metrics.notPlaced})[0];
    currentPlan=best.plan;renderPlan();$("variants").innerHTML=out.map(function(x){return '<button class="variant '+(x.key===best.key?"active":"")+'" data-variant="'+x.key+'"><b>'+x.label+'</b><span>'+fmt(x.plan.metrics.utilization,1)+"% · "+x.plan.metrics.sheets+" листов · "+(x.plan.metrics.notPlaced?"не размещено "+x.plan.metrics.notPlaced:"все детали")+"</span></button>"}).join("");$("variants-panel").classList.remove("hidden");
    $("variants").querySelectorAll("[data-variant]").forEach(function(b){b.onclick=function(){var x=out.find(function(v){return v.key===b.dataset.variant});currentPlan=x.plan;renderPlan();$("variants").querySelectorAll(".variant").forEach(function(v){v.classList.toggle("active",v===b)})}});
  }catch(e){toast(e.message,"error")}finally{setBusy(false)}
}
function bind(){
  $("add-sheet").onclick=function(){state.sheets.push({id:crypto.randomUUID(),name:"Лист",width:2000,height:1250,qty:1,priority:1,source:"stock"});save();renderSheets();renderSummary()};
  $("add-part").onclick=addManual;$("file").onchange=function(e){importFiles(e.target.files);e.target.value=""};
  $("dropzone").ondragover=function(e){e.preventDefault();$("dropzone").classList.add("drag")};$("dropzone").ondragleave=function(){$("dropzone").classList.remove("drag")};$("dropzone").ondrop=function(e){e.preventDefault();$("dropzone").classList.remove("drag");importFiles(e.dataTransfer.files)};
  ["job-name","material","technology","thickness","spacing","edge","tolerance","rotations","population","mutation","timeLimit","holes","concave","mirror"].forEach(function(id){$(id).addEventListener("change",syncControls)});
  $("run").onclick=run;$("compare").onclick=compare;$("save-remnants").onclick=function(){if(currentPlan)saveResultRemnants()};
  $("export-svg").onclick=function(){if(currentPlan)download("nestcut-plan.svg",new Blob([planToSvg(currentPlan)],{type:"image/svg+xml"}))};
  $("export-dxf").onclick=function(){if(currentPlan)download("nestcut-plan.dxf",new Blob([planToDxf(currentPlan)],{type:"application/dxf"}))};
  $("export-csv").onclick=function(){if(currentPlan)download("nestcut-plan.csv",new Blob([planCsv(currentPlan)],{type:"text/csv;charset=utf-8"}))};
  $("export-xlsx").onclick=function(){try{if(currentPlan)download("nestcut-plan.xlsx",new Blob([buildXlsx(currentPlan)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}))}catch(e){toast(e.message,"error")}};
  $("export-json").onclick=function(){download("nestcut-job.json",new Blob([JSON.stringify({state:state,plan:currentPlan?Object.assign({},currentPlan,{partMap:undefined}):null},null,2)],{type:"application/json"}))};
  $("print").onclick=function(){window.print()};
  $("zoom-in").onclick=function(){mapZoom=Math.min(2.5,mapZoom*1.2);renderMaps()};$("zoom-out").onclick=function(){mapZoom=Math.max(.5,mapZoom/1.2);renderMaps()};$("zoom-fit").onclick=function(){mapZoom=1;renderMaps()};
  $("clear").onclick=function(){state=createDefaultState();currentPlan=null;save();initControls();renderPlan()};
}
initControls();bind();
