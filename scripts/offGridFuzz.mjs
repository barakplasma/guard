/**
 * Does #40's `offGridPriority` close the class, or only the tested shape?
 *
 * #40 added a sort key that lifts a constrained demand ahead of an earlier,
 * less-constrained one it overlaps. That fixes every offset in
 * `midScheduleCallout.mjs`. This script asks whether it fixes the *class*.
 *
 * Random small rosters with 2-4 local missions at random off-grid starts and
 * random qualification requirements. At each instant where the engine reports
 * a shortage, brute-force whether a full staffing exists over everyone free at
 * that instant. No rest, no availability limits and no remote missions, so each
 * instant is independent and the brute force is exact.
 *
 * ponytail: brute force is exponential in headcount, hence the cap at eight
 * employees and four missions. It is an oracle for small instances, not a
 * scheduler.
 */
import { plan } from '../src/lib/planner.js';

const MIN=60*1000, HOUR=60*MIN;
const START=new Date(2026,0,5,8,0,0,0).getTime();
const END=START+12*HOUR;
const TAGS=['driver','commander','medic'];

const covers=(crew,m)=>m.requires.every(r=>crew.filter(e=>e.tags.includes(r.tag)).length>=r.count);
function staffable(employees, live){
  const used=Array.from({length:employees.length},()=>false);
  const place=(i)=>{
    if(i===live.length) return true;
    const m=live[i];
    const pool=employees.flatMap((e,j)=>(!used[j] && !m.excludes.some(t=>e.tags.includes(t)))?[j]:[]);
    if(pool.length<m.count) return false;
    const pick=(from,ch)=>{
      if(ch.length===m.count){
        if(!covers(ch.map(j=>employees[j]),m)) return false;
        ch.forEach(j=>used[j]=true);
        if(place(i+1)) return true;
        ch.forEach(j=>used[j]=false);
        return false;
      }
      for(let k=from;k<pool.length;k++) if(pick(k+1,[...ch,pool[k]])) return true;
      return false;
    };
    return pick(0,[]);
  };
  return place(0);
}

let state=20260915;
const rnd=()=>(state=(state*1103515245+12345)%2147483648)/2147483648;
let checked=0, falseShort=0;
const examples=[];

for(let iter=0; iter<6000; iter++){
  const n=4+Math.floor(rnd()*5);                       // 4..8 guards
  const employees=Array.from({length:n},(_,i)=>({
    id:`e${i+1}`, name:`G${i+1}`, tags:TAGS.filter(()=>rnd()<0.35),
  }));
  const nm=2+Math.floor(rnd()*3);                      // 2..4 missions
  const missions=Array.from({length:nm},(_,i)=>{
    const offGrid = i>0 && rnd()<0.7;
    const s = offGrid ? START + Math.floor(rnd()*6)*HOUR + Math.floor(rnd()*11+1)*5*MIN : START;
    const e = offGrid ? s + (1+Math.floor(rnd()*3))*HOUR : END;
    return {
      id:`m${i+1}`, name:`M${i+1}`, type:'local',
      start: offGrid ? s : undefined, end: offGrid ? e : undefined,
      count: 1+Math.floor(rnd()*3),
      requires: TAGS.flatMap(t=>rnd()<0.3?[{tag:t,count:1+Math.floor(rnd()*2)}]:[]),
      excludes: [],
    };
  });

  let result;
  try {
    result = plan({ start:START, end:END, shiftMinutes:60, strategy:'balanced',
      employees, missions, pins:[], nightWindows:[], tags:TAGS.map(id=>({id})),
      onInvariantViolation:'report' });
  } catch { continue; }

  const short = result.warnings.filter(w=>w.code==='understaffed'||w.code==='missing-required-tag');
  if(!short.length) continue;

  // Sample the instant each shortage names, and ask the oracle.
  for(const w of short){
    const t = w.start ?? w.windows?.[0]?.start;
    if(t==null) continue;
    const live = missions.filter(m=>(m.start??START)<=t && (m.end??END)>t);
    if(!live.length) continue;
    checked++;
    if(staffable(employees, live)){
      falseShort++;
      if(examples.length<3) examples.push({employees, missions, t, code:w.code});
      break;
    }
  }
}

console.log(`shortage instants checked : ${checked}`);
console.log(`provably false shortages  : ${falseShort}  (${checked?(100*falseShort/checked).toFixed(1):0}%)`);
for(const ex of examples){
  console.log('\n--- still falsely short on main ---');
  console.log('  employees:', ex.employees.map(e=>`${e.id}[${e.tags.join(',')||'-'}]`).join(' '));
  for(const m of ex.missions){
    const rel = m.start==null ? 'whole plan' : `+${Math.round((m.start-START)/MIN)}min for ${Math.round((m.end-m.start)/HOUR)}h`;
    console.log(`  ${m.id}: count=${m.count} requires=${m.requires.map(r=>r.tag+'x'+r.count).join('+')||'-'}  ${rel}`);
  }
  console.log(`  engine: ${ex.code} at +${Math.round((ex.t-START)/MIN)}min`);
}
