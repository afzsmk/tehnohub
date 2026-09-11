import { CalendarDay, Employee, EmployeeSchedule, Equipment, EquipmentBlock, ProductionOrder, ProductionTask, RouteOperation, ShiftDefinition } from '../types';
import { buildShiftWindows, employeeWindows, findFittingWindow, intersectWindows, subtractBlocks, TimeWindow } from './operationalCalendar';

export interface ScheduleInput { orders:ProductionOrder[]; employees:Employee[]; equipment:Equipment[]; horizonStart:string; horizonEnd:string; shifts?:ShiftDefinition[]; calendar?:CalendarDay[]; employeeSchedules?:EmployeeSchedule[]; equipmentBlocks?:EquipmentBlock[]; }
export interface ScheduleConflict { code:'NO_CAPACITY'|'QUALIFICATION'|'EQUIPMENT'|'SEQUENCE'; orderId:string; operationId:string; message:string; }
export interface ScheduleOutput { tasks:ProductionTask[]; conflicts:ScheduleConflict[]; }
const MINUTE=60_000;
function mergeOccupied(base:TimeWindow[],extra:TimeWindow[]):TimeWindow[]{return[...base,...extra].sort((a,b)=>a.start-b.start);}
function intersectMany(windows:TimeWindow[][]):TimeWindow[]{if(windows.length===0)return[];return windows.slice(1).reduce((acc,next)=>intersectWindows(acc,next),windows[0]);}
function withoutOccupied(windows:TimeWindow[],occupied:TimeWindow[]):TimeWindow[]{
  let result=[...windows];
  for(const busy of [...occupied].sort((a,b)=>a.start-b.start)){
    result=result.flatMap(window=>{
      if(busy.end<=window.start||busy.start>=window.end)return[window];
      const parts:TimeWindow[]=[];
      if(window.start<busy.start)parts.push({start:window.start,end:Math.min(window.end,busy.start),shiftId:window.shiftId});
      if(busy.end<window.end)parts.push({start:Math.max(window.start,busy.end),end:window.end,shiftId:window.shiftId});
      return parts.filter(part=>part.start<part.end);
    });
  }
  return result;
}
function operationElapsedHours(operation:RouteOperation,quantity:number):number{
  if(operation.laborNormHoursPerUnit!=null){const workers=Math.max(1,operation.workersRequired??1);return((operation.setupNormHours??0)+operation.laborNormHoursPerUnit*Math.max(0,quantity))/workers;}
  return(operation.setupMinutes+operation.runMinutesPerUnit*Math.max(0,quantity))/60;
}
function earliestEmployeeStart(candidate:number,durationMs:number,employee:Employee,equipmentWindows:TimeWindow[],baseWindows:TimeWindow[],employeeSchedules:EmployeeSchedule[],busy:TimeWindow[]):number|null{
  const ew=employeeWindows(employee.id,baseWindows,employeeSchedules);const free=withoutOccupied(ew,busy);const common=intersectWindows(free,equipmentWindows);return findFittingWindow(candidate,durationMs,common);
}
function chooseWorkerTeam(candidate:number,durationMs:number,employees:Employee[],equipmentWindows:TimeWindow[],baseWindows:TimeWindow[],employeeSchedules:EmployeeSchedule[],employeeBusy:Map<string,TimeWindow[]>,workersRequired:number):{start:number;employees:Employee[]}|null{
  if(workersRequired<=0||employees.length<workersRequired)return null;
  const ranked=employees.map(employee=>({employee,start:earliestEmployeeStart(candidate,durationMs,employee,equipmentWindows,baseWindows,employeeSchedules,employeeBusy.get(employee.id)??[])})).filter((x):x is {employee:Employee;start:number}=>x.start!==null).sort((a,b)=>a.start-b.start||a.employee.id.localeCompare(b.employee.id));
  if(ranked.length<workersRequired)return null;
  const limit=Math.min(ranked.length,Math.max(12,workersRequired*4));const pool=ranked.slice(0,limit);
  function search(index:number,selected:Array<{employee:Employee;start:number}>):{start:number;employees:Employee[]}|null{
    const remaining=workersRequired-selected.length;
    if(remaining===0){const teamStart=Math.max(candidate,...selected.map(x=>x.start));const windows=selected.map(x=>withoutOccupied(employeeWindows(x.employee.id,baseWindows,employeeSchedules),employeeBusy.get(x.employee.id)??[]));for(const w of intersectMany([equipmentWindows,...windows])){const start=Math.max(teamStart,w.start);if(start+durationMs<=w.end)return{start,employees:selected.map(x=>x.employee)};}return null;}
    for(let i=index;i<=pool.length-remaining;i++){const result=search(i+1,[...selected,pool[i]]);if(result)return result;}return null;
  }
  return search(0,[]);
}
export function buildDeterministicSchedule(input:ScheduleInput):ScheduleOutput{
  const start=new Date(input.horizonStart).getTime(),end=new Date(input.horizonEnd).getTime();const shifts=input.shifts??[],calendar=input.calendar??[];const baseWindows=shifts.length>0&&calendar.length>0?buildShiftWindows(input.horizonStart,input.horizonEnd,shifts,calendar):[{start,end}];const employeeSchedules=input.employeeSchedules??[],equipmentBlocks=input.equipmentBlocks??[];const employeeBusy=new Map<string,TimeWindow[]>(),equipmentBusy=new Map<string,TimeWindow[]>(),tasks:ProductionTask[]=[],conflicts:ScheduleConflict[]=[];
  const orders=[...input.orders].sort((a,b)=>{const p={URGENT:0,HIGH:1,NORMAL:2,LOW:3} as const;return p[a.priority]-p[b.priority]||new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime();});
  for(const order of orders){let sequenceEnd=start;for(const operation of [...order.route].sort((a,b)=>a.sequence-b.sequence)){
    const workersRequired=Math.max(1,operation.workersRequired??1),hours=operationElapsedHours(operation,order.quantity);if(hours<=0){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Для операции не задана положительная трудовая норма.'});continue;}
    const durationMs=Math.max(MINUTE,Math.ceil(hours*3600)*1000),candidate=Math.max(sequenceEnd,start);if(candidate>=end){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Операция выходит за горизонт плана.'});continue;}
    const employeePool=input.employees.filter(e=>e.active&&(!operation.requiredQualification||e.qualificationLevel>=operation.requiredQualification));if(employeePool.length<workersRequired){conflicts.push({code:'QUALIFICATION',orderId:order.id,operationId:operation.id,message:`Нужно ${workersRequired} сотрудников требуемой квалификации, доступно ${employeePool.length}.`});continue;}
    const equipmentPool=input.equipment.filter(e=>e.active&&(!operation.requiredEquipmentIds?.length||operation.requiredEquipmentIds.includes(e.id))&&(!operation.requiredEquipmentIds?.length?e.workCenter===operation.workCenter:true));if(equipmentPool.length===0){conflicts.push({code:'EQUIPMENT',orderId:order.id,operationId:operation.id,message:'Нет оборудования для операции.'});continue;}
    let selectedEmployees:Employee[]|undefined,selectedEquipment:Equipment|undefined,plannedStart:number|null=null;
    for(const equipment of equipmentPool){const equipmentWindows=subtractBlocks(baseWindows,equipmentBlocks.filter(b=>b.equipmentId===equipment.id));const team=chooseWorkerTeam(candidate,durationMs,employeePool,equipmentWindows,baseWindows,employeeSchedules,employeeBusy,workersRequired);if(team&&(plannedStart===null||team.start<plannedStart)){plannedStart=team.start;selectedEmployees=team.employees;selectedEquipment=equipment;}}
    if(plannedStart===null||!selectedEmployees||!selectedEquipment){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Нет совместного окна оборудования и команды сотрудников с учётом смен и блокировок.'});continue;}
    const plannedEnd=plannedStart+durationMs;if(plannedEnd>end){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Операция не помещается в горизонт.'});continue;}
    for(const employee of selectedEmployees)employeeBusy.set(employee.id,mergeOccupied(employeeBusy.get(employee.id)??[],[{start:plannedStart,end:plannedEnd}]));
    equipmentBusy.set(selectedEquipment.id,mergeOccupied(equipmentBusy.get(selectedEquipment.id)??[],[{start:plannedStart,end:plannedEnd}]));sequenceEnd=plannedEnd;
    tasks.push({id:`${order.id}:${operation.id}:v1`,orderId:order.id,operationId:operation.id,operationSequence:operation.sequence,status:'PLANNED',plannedStart:new Date(plannedStart).toISOString(),plannedEnd:new Date(plannedEnd).toISOString(),plannedQuantity:order.quantity,actualQuantity:0,assignedEmployeeIds:selectedEmployees.map(e=>e.id),assignedEquipmentIds:[selectedEquipment.id],version:1});
  }}
  return{tasks,conflicts};
}
