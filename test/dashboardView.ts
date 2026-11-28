import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Execute the actual browser script with a minimal DOM. This guards against
// sample records appearing before sign-in, after a failed request or on logout.
const source=readFileSync(new URL("../public/dashboard/dashboard.js",import.meta.url),"utf8");
function workspace(authenticated:boolean, fail=false) {
  const nodes=new Map<string,any>();
  const node=(key:string)=>{
    if(!nodes.has(key))nodes.set(key,{innerHTML:"",textContent:"",hidden:false,disabled:false,value:"",events:new Map(),classList:{toggle(){}},setAttribute(){},addEventListener(name:string,callback:unknown){this.events.set(name,callback);},focus(){}});
    return nodes.get(key);
  };
  const intervals:number[]=[];
  const context=createContext({location:{hostname:"c7-automation-os.vercel.app"},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},hidden:false},
    setTimeout:()=>0,clearTimeout(){},setInterval:(_fn:unknown,ms:number)=>{intervals.push(ms);return 1;},clearInterval(){},AbortSignal,
    fetch:async(path:string)=>{
      if(fail)throw new Error("offline");
      return {ok:true,json:async()=>path.endsWith("/api/session")?{authenticated,localAvailable:false}:{appointments:[{id:"actual",name:"Actual WhatsApp Patient",reference:"C7-ACTUAL",service:"Initial consultation",practitioner:"unassigned",startsAt:"2026-11-25T08:00:00Z",duration:45,status:"confirmed"}],fetchedAt:new Date().toISOString()}};
    }});
  runInContext(source,context);
  return {nodes,node,context,intervals};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const failed of [false,true]){
  const view=workspace(false,failed);await flush();
  assert.equal(view.node("#demo-button").hidden,true);
  assert.equal(view.node("#reset-demo").hidden,true);
  assert.match(view.node("#content").innerHTML,/Sign in above/);
  assert(!view.node("#content").innerHTML.includes("Casey"));
  assert.equal(runInContext("state.appointments.length",view.context),0);
  assert.equal(view.node("#connection-panel").hidden,false);
}
const connected=workspace(true);await flush();
assert.equal(runInContext("state.appointments[0].reference",connected.context),"C7-ACTUAL");
assert.equal(connected.node("#connection-panel").hidden,true);
assert(connected.intervals.includes(5000));
assert(!connected.node("#content").innerHTML.includes("Casey Morgan"));
await connected.node("#connect-button").events.get("click")();
assert.equal(runInContext("state.appointments.length",connected.context),0);
assert.equal(connected.node("#demo-button").hidden,true);
assert.match(connected.node("#content").innerHTML,/Sign in above/);
console.log("Hosted view passed: no sample bookings before sign-in, on network failure or after sign-out; actual records and five-second refresh on connection.");
