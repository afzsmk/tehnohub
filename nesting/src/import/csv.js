export function parsePartsCsv(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out=[];
  for(let i=0;i<lines.length;i++){
    const cells=(lines[i].includes("\t")?lines[i].split("\t"):lines[i].split(/[;,]/)).map(s=>s.trim().replace(/^"|"$/g,""));
    if(i===0 && Number.isNaN(Number(String(cells[1]||"").replace(",",".")))) continue;
    if(cells.length<3) continue;
    const name=cells[0]||("Деталь "+(out.length+1));
    const w=Number(String(cells[1]).replace(",",".")), h=Number(String(cells[2]).replace(",","."));
    const qty=Math.max(1,Math.round(Number(String(cells[3]||1).replace(",","."))));
    if(w>0&&h>0) out.push({id:crypto.randomUUID(),name,quantity:qty,source:"csv",geometry:{loops:[[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}]],loopDepths:[0]}});
  }
  return out;
}
