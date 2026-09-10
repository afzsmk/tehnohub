import { CalendarDay, Employee, EmployeeSchedule, Equipment, EquipmentBlock, ProductionOrder, ProductionTask, RouteOperation, ShiftDefinition } from '../types';
import { buildShiftWindows, employeeWindows, findFittingWindow, intersectWindows, subtractBlocks, TimeWindow } from './operationalCalendar';

export interface ScheduleInput { orders: ProductionOrder[]; employees: Employee[]; equipment: Equipment[]; horizonStart: string; horizonEnd: string; shifts?: ShiftDefinition[]; calendar?: CalendarDay[]; employeeSchedules?: EmployeeSchedule[]; equipmentBlocks?: EquipmentBlock[]; }
export interface ScheduleConflict { code:'NO_CAPACITY'|'QUALIFICATION'|'EQUIPMENT'|'SEQUENCE'; orderId:string; operationId:string; message:string; }
export interface ScheduleOutput { tasks:ProductionTask[]; conflicts:ScheduleConflict[]; }
const MINUTE=60_000;
function mergeOccupied(base:TimeWindow[],extra:TimeWindow[]):TimeWindow[]{ return [...base,...extra].sort((a,b)=>a.start-b.start); }
function chooseBestStart(candidate:number,durationMs:number,employeeWindowsForShift:TimeWindow[],equipmentWindowsForShift:TimeWindow[],employeeBusy:TimeWindow[],equipmentBusy:TimeWindow[]):number|null{
  const commonWindows=intersectWindows(employeeWindowsForShift,equipmentWindowsForShift); let best:number|null=null;
  for(const common of commonWindows){
    const start=findFittingWindow(Math.max(candidate,common.start),durationMs,[common],employeeBusy); if(start===null||start+durationMs>common.end)continue;
    const adjusted=findFittingWindow(start,durationMs,[common],equipmentBusy); if(adjusted===null||adjusted+durationMs>common.end)continue;
    if(best===null||adjusted<best)best=adjusted;
  } return best;
}
function operationElapsedHours(operation:RouteOperation,quantity:number):number{
  if(operation.laborNormHoursPerUnit!=null){
    const workers=Math.max(1,operation.workersRequired??1); const setup=operation.setupNormHours??0;
    return (setup+operation.laborNormHoursPerUnit*Math.max(0,quantity))/workers;
  }
  return (operation.setupMinutes+operation.runMinutesPerUnit*Math.max(0,quantity))/60;
}
export function buildDeterministicSchedule(input:ScheduleInput):ScheduleOutput{
  const start=new Date(input.horizonStart).getTime(), end=new Date(input.horizonEnd).getTime();
  const shifts=input.shifts??[], calendar=input.calendar??[];
  const baseWindows=shifts.length>0&&calendar.length>0?buildShiftWindows(input.horizonStart,input.horizonEnd,shifts,calendar):[{start,end}];
  const employeeSchedules=input.employeeSchedules??[], equipmentBlocks=input.equipmentBlocks??[];
  const employeeBusy=new Map<string,TimeWindow[]>(), equipmentBusy=new Map<string,TimeWindow[]>(), tasks:ProductionTask[]=[], conflicts:ScheduleConflict[]=[];
  const orders=[...input.orders].sort((a,b)=>{const p={URGENT:0,HIGH:1,NORMAL:2,LOW:3} as const;return p[a.priority]-p[b.priority]||new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime();});
  for(const order of orders){
    let sequenceEnd=start;
    for(const operation of [...order.route].sort((a,b)=>a.sequence-b.sequence)){
      const hours=operationElapsedHours(operation,order.quantity); if(hours<=0){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Для операции не задана положительная трудовая норма.'});continue;}
      const durationMs=Math.max(MINUTE,Math.ceil(hours*3600)*1000), candidate=Math.max(sequenceEnd,start);
      if(candidate>=end){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Операция выходит за горизонт плана.'});continue;}
      const employeePool=input.employees.filter(e=>e.active&&(!operation.requiredQualification||e.qualificationLevel>=operation.requiredQualification));
      if(employeePool.length===0){conflicts.push({code:'QUALIFICATION',orderId:order.id,operationId:operation.id,message:'Нет сотрудника требуемой квалификации.'});continue;}
      const equipmentPool=input.equipment.filter(e=>e.active&&(!operation.requiredEquipmentIds?.length||operation.requiredEquipmentIds.includes(e.id))&&(!operation.requiredEquipmentIds?.length?e.workCenter===operation.workCenter:true));
      if(equipmentPool.length===0){conflicts.push({code:'EQUIPMENT',orderId:order.id,operationId:operation.id,message:'Нет оборудования для операции.'});continue;}
      let selectedEmployee:Employee|undefined,selectedEquipment:Equipment|undefined,plannedStart:number|null=null;
      for(const employee of employeePool){const employeeWindowsForShift=employeeWindows(employee.id,baseWindows,employeeSchedules);for(const equipment of equipmentPool){const equipmentWindows=subtractBlocks(baseWindows,equipmentBlocks.filter(b=>b.equipmentId===equipment.id));const s=chooseBestStart(candidate,durationMs,employeeWindowsForShift,equipmentWindows,employeeBusy.get(employee.id)??[],equipmentBusy.get(equipment.id)??[]);if(s!==null&&(plannedStart===null||s<plannedStart)){plannedStart=s;selectedEmployee=employee;selectedEquipment=equipment;}}}
      if(plannedStart===null||!selectedEmployee||!selectedEquipment){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Нет совместного окна сотрудника и оборудования с учётом смен и блокировок.'});continue;}
      const plannedEnd=plannedStart+durationMs; if(plannedEnd>end){conflicts.push({code:'NO_CAPACITY',orderId:order.id,operationId:operation.id,message:'Операция не помещается в горизонт.'});continue;}
      employeeBusy.set(selectedEmployee.id,mergeOccupied(employeeBusy.get(selectedEmployee.id)??[],[{start:plannedStart,end:plannedEnd}]));
      equipmentBusy.set(selectedEquipment.id,mergeOccupied(equipmentBusy.get(selectedEquipment.id)??[],[{start:plannedStart,end:plannedEnd}]));
      sequenceEnd=plannedEnd;
      tasks.push({id:`${order.id}:${operation.id}:v1`,orderId:order.id,operationId:operation.id,operationSequence:operation.sequence,status:'PLANNED',plannedStart:new Date(plannedStart).toISOString(),plannedEnd:new Date(plannedEnd).toISOString(),plannedQuantity:order.quantity,actualQuantity:0,assignedEmployeeIds:[selectedEmployee.id],assignedEquipmentIds:[selectedEquipment.id],version:1});
    }
  }
  return {tasks,conflicts};
}
