/* No framework or external asset requests. Demo writes never reach the server. */
"use strict";
const $ = (s, root = document) => root.querySelector(s);
const icons = {
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  list:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  message:'<path d="M21 11.5a9 9 0 0 1-13 8L3 21l1.5-5A9 9 0 1 1 21 11.5Z"/><path d="M8 10h8m-8 4h5"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  link:'<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  flask:'<path d="M9 3h6m-5 0v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/>',
  play:'<path d="m9 5 11 7-11 7V5Z"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  back:'<path d="m15 5-7 7 7 7"/>',
  move:'<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
  headset:'<path d="M3 14v-3a9 9 0 0 1 18 0v3m-18-3h3v8H5a2 2 0 0 1-2-2v-6Zm18 0h-3v8h1a2 2 0 0 0 2-2v-6Zm0 6v2a3 3 0 0 1-3 3h-4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5m-5 0a8 8 0 0 1 14-6m2 6a8 8 0 0 1-14 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.calendar}</svg>`;
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const addDays = (date, count) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0,10);
const dateLabel = (date, options = {weekday:"long",day:"numeric",month:"long"}) => new Intl.DateTimeFormat("en-ZA",options).format(new Date(`${date}T12:00:00Z`));
const timeOf = iso => new Intl.DateTimeFormat("en-GB", {timeZone:"Africa/Johannesburg",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
const dateOf = iso => new Intl.DateTimeFormat("en-CA", {timeZone:"Africa/Johannesburg",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));
const initials = name => name.replace(/^Dr /, "").split(/\s+/).map(p => p[0]).slice(0,2).join("");
const team = [{id:"nandi",name:"Dr Nandi Mokoena",role:"Physiotherapist",speciality:"General & sports rehabilitation"},{id:"alex",name:"Dr Alex Scott",role:"Physiotherapist",speciality:"Movement & recovery"}];
let state = {view:"calendar",date:today(),period:"day",filter:"all",mode:"demo",appointments:[],activities:[],search:"",status:"all",thread:"casey",takeover:false,scenario:0,token:"",auth:"",lastSync:null};
let toastTimer, pollTimer, drawerReturnFocus, loadVersion = 0;
const extraMessages = [];
function seed() {
  const d = today();
  state.appointments = [
    {id:"avery",name:"Avery Testwell",service:"Initial consultation",practitioner:"nandi",startsAt:`${d}T09:00:00+02:00`,duration:45,status:"confirmed",reference:"C7-AVRY",reminder:"Provider accepted"},
    {id:"casey",name:"Casey Morgan",service:"Initial consultation",practitioner:"nandi",startsAt:`${d}T10:00:00+02:00`,duration:45,status:"confirmed",reference:"C7-DEMO",reminder:"Not recorded"},
    {id:"sam",name:"Sam Dlamini",service:"Follow-up",practitioner:"alex",startsAt:`${d}T10:30:00+02:00`,duration:30,status:"confirmed",reference:"C7-SAMD",reminder:"Provider accepted"},
    {id:"jordan",name:"Jordan Ellis",service:"Sports rehabilitation",practitioner:"alex",startsAt:`${d}T14:30:00+02:00`,duration:45,status:"confirmed",reference:"C7-JORD",reminder:"Not recorded"},
    {id:"robin",name:"Robin Taylor",service:"Follow-up",practitioner:"nandi",startsAt:`${addDays(d,1)}T11:00:00+02:00`,duration:30,status:"confirmed",reference:"C7-ROBN",reminder:"Not recorded"},
    {id:"lee",name:"Lee Jacobs",service:"Initial consultation",practitioner:"alex",startsAt:`${addDays(d,2)}T09:30:00+02:00`,duration:45,status:"confirmed",reference:"C7-LEET",reminder:"Not recorded"},
  ];
  state.activities = [{icon:"check",title:"Avery’s appointment confirmed",text:"Initial consultation at 09:00 with Dr Nandi Mokoena.",at:"08:47"},{icon:"bell",title:"Morning schedule shared",text:"Practitioners received their 07:00 schedule in this demo.",at:"07:00"}];
  state.scenario=0;state.takeover=false;extraMessages.length=0;
}
function decorate() { document.querySelectorAll("[data-icon]").forEach(el => el.innerHTML = icon(el.dataset.icon)); }
function toast(message) {clearTimeout(toastTimer);$("#toast").textContent=message;$("#toast").hidden=false;toastTimer=setTimeout(()=>$("#toast").hidden=true,4500);}
function visibleAppointments() {return state.appointments.filter(a => state.filter === "all" || a.practitioner === state.filter);}
function practitioners() {return state.mode === "demo" ? team : [...new Set(state.appointments.map(a=>a.practitioner))].map(id => ({id,name:id === "unassigned" ? "Practice calendar" : id,role:id === "unassigned" ? "Practitioner not assigned" : "Pilot resource"}));}
function practitionerName(id) {return practitioners().find(p=>p.id===id)?.name || "Practice calendar";}
function render() {
  const titles = {calendar:["YOUR PRACTICE AT A GLANCE","The day, taken care of.","Every appointment in view. Everyone on the same page."],appointments:["YOUR APPOINTMENT BOOK","A place for every patient.","Find a booking, check its details, keep the day moving."],inbox:["THE CONVERSATION CONTINUES","A human touch, when it matters.","See how your team can step into a patient conversation."],practitioners:["THE PEOPLE BEHIND THE PRACTICE","One team. A clearer day.","Separate schedules, shared visibility."]};
  const t=titles[state.view];$("#eyebrow").textContent=t[0];$("#page-title").textContent=t[1];$("#page-description").textContent=t[2];
  $("#breadcrumb").textContent=state.view[0].toUpperCase()+state.view.slice(1);
  document.querySelectorAll("[data-view]").forEach(b=>{b.classList.toggle("active",b.dataset.view===state.view);b.setAttribute("aria-current",b.dataset.view===state.view?"page":"false");});
  $("#demo-button").hidden=state.mode!=="demo";$("#reset-demo").hidden=state.mode!=="demo";
  $("#refresh-pilot").hidden=state.mode!=="pilot";
  $(".nav-count").hidden=state.mode!=="demo";
  $("#mode-label").innerHTML=`<i></i>${state.mode==="demo"?"Demo workspace":"Pilot · read-only"}`;
  $("#banner-title").textContent=state.mode==="demo"?"A little preview of a calmer practice.":"Connected to the Meridian pilot.";
  $("#banner-copy").textContent=state.mode==="demo"?"Fictional patients. Real possibilities.":"Read-only bookings. Refreshes every 30 seconds.";
  $("#connect-button").innerHTML=icon(state.mode==="demo"?"link":"close")+(state.mode==="demo"?"Connect pilot":"Back to demo");
  $("#footer-status").textContent=state.mode==="demo"?"Demo data · Changes stay in this tab":`Pilot bookings · Last loaded ${state.lastSync?timeOf(state.lastSync):"just now"} SAST`;
  $("#content").innerHTML=state.view==="calendar"?calendar():state.view==="appointments"?appointmentList():state.view==="inbox"?inbox():practitionerList();
  decorate();
}
function filterOptions() {return `<option value="all">All practitioners</option>${practitioners().map(p=>`<option value="${esc(p.id)}" ${state.filter===p.id?"selected":""}>${esc(p.name)}</option>`).join("")}`;}
function calendar() {
  const ps=practitioners().filter(p=>state.filter==="all"||p.id===state.filter);
  if(!ps.length)ps.push({id:"unassigned",name:"Practice calendar",role:"No bookings in this period"});
  const columns=state.period==="week"?Array.from({length:7},(_,i)=>({date:addDays(state.date,i),name:dateLabel(addDays(state.date,i),{weekday:"short"}),role:dateLabel(addDays(state.date,i),{day:"numeric",month:"short"})})):ps.map(p=>({...p,date:state.date}));
  return `<div class="calendar-layout"><section class="calendar-panel" aria-label="Appointment calendar"><div class="calendar-toolbar"><div class="date-controls"><button class="icon-button" data-action="previous" aria-label="Previous ${state.period}">${icon("back")}</button><input type="date" id="calendar-date" value="${state.date}" aria-label="Calendar date"><button class="icon-button" data-action="next" aria-label="Next ${state.period}">${icon("chevron")}</button><button class="button small" data-action="today">Today</button></div><div class="toolbar-actions"><div class="segmented" aria-label="Calendar view"><button data-period="day" class="${state.period==="day"?"selected":""}" aria-pressed="${state.period==="day"}">Day</button><button data-period="week" class="${state.period==="week"?"selected":""}" aria-pressed="${state.period==="week"}">Week</button></div></div></div><div class="calendar-filter"><label><select id="practitioner-filter" aria-label="Filter practitioner">${filterOptions()}</select></label><span>${visibleAppointments().filter(a=>a.status!=="cancelled"&&dateOf(a.startsAt)>=state.date&&dateOf(a.startsAt)<addDays(state.date,state.period==="week"?7:1)).length} appointments · SAST</span></div><div class="calendar-scroll"><div class="calendar-grid ${state.period==="week"?"week-grid":""}" style="--columns:${columns.length}"><div class="calendar-corner"></div>${columns.map(c=>`<div class="practitioner-header">${state.period==="day"?`<span class="avatar">${esc(initials(c.name))}</span>`:""}<span>${esc(c.name)}<small>${esc(c.role)}</small></span></div>`).join("")}<div class="time-gutter">${Array.from({length:10},(_,i)=>`<span class="time-label" style="top:${i*64}px">${String(i+8).padStart(2,"0")}:00</span>`).join("")}</div>${columns.map(c=>`<div class="day-column">${visibleAppointments().filter(a=>dateOf(a.startsAt)===c.date&&a.status!=="cancelled"&&(state.period==="week"||a.practitioner===c.id)).map(a=>appointmentBlock(a)).join("")}${state.mode==="demo"&&state.period==="day"&&c.id==="alex"&&c.date===today()?'<div class="leave-block" style="top:320px;height:64px"><strong>Personal time</strong>13:00 – 14:00</div>':""}</div>`).join("")}</div></div><div class="calendar-key"><span><i class="key-dot"></i>Consultation</span><span><i class="key-dot blue"></i>Follow-up</span><span>Click an appointment for details</span></div></section>${activityRail()}</div>`;
}
function appointmentBlock(a) {
  const [h,m]=timeOf(a.startsAt).split(":").map(Number), start=(h-8)*64+m*64/60;
  if(start<0||start>=576)return "";
  const height=Math.min(a.duration*64/60,576-start);
  // Simultaneous bookings remain separately clickable in the week view.
  const peers=visibleAppointments().filter(b=>b.status!=="cancelled"&&dateOf(b.startsAt)===dateOf(a.startsAt)&&(state.period==="week"||b.practitioner===a.practitioner)&&Date.parse(b.startsAt)<Date.parse(a.startsAt)+a.duration*60000&&Date.parse(b.startsAt)+b.duration*60000>Date.parse(a.startsAt)).sort((x,y)=>x.id.localeCompare(y.id));
  const width=peers.length>1?`left:calc(${peers.findIndex(b=>b.id===a.id)*100/peers.length}% + 4px);right:auto;width:calc(${100/peers.length}% - 8px);`:"";
  return `<button class="appointment ${a.service.toLowerCase().includes("follow")?"followup":""} ${a.movedFrom?"moved":""}" style="top:${start}px;height:${Math.max(height-3,27)}px;${width}" data-appointment="${esc(a.id)}" aria-label="${esc(a.name)}, ${timeOf(a.startsAt)}, ${esc(a.service)}"><strong>${esc(a.name)}</strong>${height>=64?`<span>${esc(a.service)}</span>`:""}${height>=40?`<small>${timeOf(a.startsAt)} – ${timeOf(new Date(Date.parse(a.startsAt)+a.duration*60000).toISOString())}</small>`:""}${a.movedFrom?`<span class="move-tag">Moved from ${esc(a.movedFrom)}</span>`:""}</button>`;
}
function activityRail() {
  return `<aside class="rail" aria-label="Recent updates"><div class="rail-heading"><h2>Latest updates</h2><span class="live-label"><i></i>${state.mode==="demo"?"Demo activity":"Booking snapshot"}</span></div><div class="activity-feed">${state.mode==="demo"?state.activities.slice(0,4).map(a=>`<div class="activity-item"><span class="activity-icon">${icon(a.icon)}</span><div><strong>${esc(a.title)}</strong><p>${esc(a.text)}</p><time>${esc(a.at)}</time></div></div>`).join(""):'<div class="activity-item"><span class="activity-icon">'+icon("refresh")+'</span><div><strong>Pilot bookings connected</strong><p>The calendar reads stored bookings. Delivery receipts and a live activity feed are coming next.</p></div></div>'}</div>${state.mode==="demo"?`<div class="handover"><div class="handover-label">${icon("headset")} ${state.takeover?"Demo takeover active":"A little help needed"}</div><h3>Casey asked to speak to someone</h3><p>“Could someone explain what I need to bring to my first visit?”</p><button class="button" data-action="open-inbox">Open conversation ${icon("chevron")}</button></div><div class="daily-note">${icon("bell")}<span>A clearer start to the day.<br>Daily WhatsApp schedules at <strong>07:00</strong> in this demonstration.</span></div>`:'<div class="daily-note">'+icon("calendar")+'<span>Unassigned bookings appear in the practice calendar. Multi-practitioner routing is a separate backend step.</span></div>'}</aside>`;
}
function appointmentList() {
  const data=visibleAppointments().filter(a=>(state.status==="all"||a.status===state.status)&&`${a.name} ${a.reference} ${a.service}`.toLowerCase().includes(state.search.toLowerCase())).sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  return `<section class="table-panel"><div class="list-toolbar"><input id="booking-search" type="search" placeholder="Search patient, reference or service…" aria-label="Search appointments" value="${esc(state.search)}"><select id="status-filter" aria-label="Filter status">${["all","confirmed","cancelled","completed"].map(s=>`<option value="${s}" ${state.status===s?"selected":""}>${s==="all"?"All statuses":s[0].toUpperCase()+s.slice(1)}</option>`).join("")}</select><select id="practitioner-filter" aria-label="Filter practitioner">${filterOptions()}</select></div><div class="table-scroll"><table><thead><tr><th>Patient</th><th>Appointment</th><th>Practitioner</th><th>Status</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>${data.map(a=>`<tr><td><div class="patient-cell"><span class="avatar">${esc(initials(a.name))}</span><span><strong>${esc(a.name)}</strong><small>${esc(a.reference)}</small></span></div></td><td>${dateLabel(dateOf(a.startsAt),{day:"numeric",month:"short"})} · ${timeOf(a.startsAt)}<small>${esc(a.service)} · ${a.duration} min</small></td><td>${esc(practitionerName(a.practitioner))}</td><td><span class="badge ${esc(a.status)}">${esc(a.status)}</span></td><td><button class="icon-button" data-appointment="${esc(a.id)}" aria-label="Open ${esc(a.name)} appointment">${icon("chevron")}</button></td></tr>`).join("")}</tbody></table>${!data.length?`<div class="empty-state">${icon("calendar")}<strong>No appointments here yet</strong>${state.search?"Try another name or reference.":"Choose another filter or calendar period."}</div>`:""}</div></section>`;
}
function inbox() {
  if(state.mode!=="demo")return `<div class="table-panel empty-state">${icon("message")}<strong>Your pilot inbox is the next connection.</strong>This version connects booking records only. Switch back to the demo to explore conversations and handover.</div>`;
  const casey=state.thread==="casey";
  const messages=casey?[{role:"user",text:"Hi, I’d like to book an initial consultation for 10:00 today.",at:"08:30"},{role:"assistant",text:"You’re booked for 10:00 with Dr Nandi Mokoena. Your reference is C7-DEMO.",at:"08:30"},{role:"user",text:"Could someone explain what I need to bring to my first visit?",at:"08:32"},{role:"assistant",text:"I’ll flag this for the practice team so they can help you.",at:"08:32"},...extraMessages]:[{role:"user",text:"Thank you, see you at 09:00!",at:"08:47"},{role:"assistant",text:"We look forward to seeing you, Avery. Your reference is C7-AVRY.",at:"08:47"}];
  return `<section class="inbox-layout"><aside class="thread-list"><div class="thread-list-heading">Conversations <span class="badge">Demo</span></div>${[{id:"casey",name:"Casey Morgan",text:"Could someone explain what I need to bring?",at:"Needs the team"},{id:"avery",name:"Avery Testwell",text:"Thank you, see you at 09:00!",at:"Handled by receptionist"}].map(c=>`<button data-thread="${c.id}" class="thread ${state.thread===c.id?"selected":""}"><span class="avatar">${initials(c.name)}</span><span><strong>${c.name}</strong><p>${c.text}</p><small>${c.at}</small></span></button>`).join("")}</aside><div class="conversation"><div class="conversation-header"><div><h3>${casey?"Casey Morgan":"Avery Testwell"}</h3><small>WhatsApp · Fictional conversation</small></div>${casey?`<button class="button ${state.takeover?"":"primary"} small" data-action="takeover">${state.takeover?"Return to AI preview":"Preview takeover"}</button>`:'<span class="badge">Handled</span>'}</div><div class="chat-preview-label">${state.takeover&&casey?"Handover preview: replies below stay in this browser. No WhatsApp message is sent.":"Demo inbox. Live team replies and AI pause are not connected yet."}</div><div class="chat-messages"><div class="chat-day">${dateLabel(today())}</div>${messages.map(m=>`<div class="bubble ${m.role}">${esc(m.text)}<small>${m.at} · ${m.role==="user"?"Patient":m.team?"Practice team preview":"AI receptionist"}</small></div>`).join("")}</div><form id="reply-form" class="chat-composer"><input id="reply-text" aria-label="Demo reply" placeholder="${state.takeover&&casey?"Write a demo reply…":"Preview takeover to write a reply"}" ${state.takeover&&casey?"":"disabled"} required maxlength="1000"><button class="button primary" ${state.takeover&&casey?"":"disabled"} aria-label="Add demo reply">${icon("send")}</button></form></div></section>`;
}
function practitionerList() {
  return `<section class="team-list">${practitioners().map(p=>`<div class="team-row"><span class="avatar">${esc(initials(p.name))}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.speciality||p.role)}</p><small>${state.mode==="demo"?"Demo schedule · Mon–Fri, 08:00–17:00":"Stored booking resource · read-only"}</small></div><button class="button small" data-practitioner="${esc(p.id)}">View schedule ${icon("chevron")}</button></div>`).join("")||'<div class="empty-state"><strong>No practitioner resources recorded</strong>New bookings without a resource appear under Practice calendar.</div>'}</section><div class="detail-note">${state.mode==="demo"?"This preview shows two fictional practitioners. Separate calendars, leave rules and booking assignment still need to be connected for a live practice.":"This list reflects resources on stored bookings. It does not configure practitioner calendars."}</div>`;
}
function openDrawer(html) {
  drawerReturnFocus=document.activeElement;$("#drawer").innerHTML=html;$("#drawer").hidden=false;$("#drawer-backdrop").hidden=false;$(".app-shell").inert=true;document.body.style.overflow="hidden";$("#drawer button")?.focus();
}
function closeDrawer() {$("#drawer").hidden=true;$("#drawer-backdrop").hidden=true;$(".app-shell").inert=false;document.body.style.overflow="";drawerReturnFocus?.isConnected&&drawerReturnFocus.focus();}
function drawerHeader(label) {return `<div class="drawer-header"><div class="eyebrow">${label}</div><button class="icon-button" data-action="close-drawer" aria-label="Close details">${icon("close")}</button></div>`;}
function showAppointment(id) {
  const a=state.appointments.find(b=>b.id===id);if(!a)return;
  openDrawer(`${drawerHeader("APPOINTMENT DETAILS")}<span class="avatar">${esc(initials(a.name))}</span><h2 id="drawer-title">${esc(a.name)}</h2><p class="drawer-subtitle">${esc(a.service)}</p><span class="badge ${esc(a.status)}">${esc(a.status)}</span><dl class="detail-grid"><div><dt>Date</dt><dd>${dateLabel(dateOf(a.startsAt),{weekday:"short",day:"numeric",month:"long"})}</dd></div><div><dt>Time</dt><dd>${timeOf(a.startsAt)} · ${a.duration} minutes</dd></div><div><dt>Practitioner</dt><dd>${esc(practitionerName(a.practitioner))}</dd></div><div><dt>Reference</dt><dd>${esc(a.reference)}</dd></div><div><dt>Reminder submission</dt><dd>${esc(a.reminder)}</dd></div><div><dt>Booking source</dt><dd>${state.mode==="demo"?"WhatsApp demo":"Pilot booking record"}</dd></div></dl><div class="detail-note">${state.mode==="demo"?"Fictional booking. Changes below update this demonstration only.":"Read-only pilot view. Make changes through the existing WhatsApp booking flow. A reminder submission does not prove delivery."}</div>${a.status==="confirmed"&&state.mode==="demo"?`<div class="drawer-actions"><button class="button primary" data-reschedule="${esc(id)}">${icon("move")}Move appointment</button><button class="button danger" data-cancel="${esc(id)}">Cancel appointment</button></div><div id="appointment-form"></div>`:""}`);
}
function showReschedule(id) {
  const a=state.appointments.find(b=>b.id===id);if(!a||state.mode!=="demo")return;
  $("#appointment-form").innerHTML=`<form id="move-form" class="inline-form" data-id="${esc(id)}"><label>New date<input name="date" type="date" value="${dateOf(a.startsAt)}" required></label><label>New time<input name="time" type="time" step="900" min="08:00" max="16:45" value="${timeOf(a.startsAt)}" required></label><p id="move-error" class="form-error" role="alert"></p><div><button class="button primary" type="submit">Save demo change</button><button class="button" type="button" data-action="clear-form">Keep appointment</button></div></form>`;$("#move-form input").focus();
}
function addActivity(title,text,type="move") {state.activities.unshift({title,text,icon:type,at:timeOf(new Date().toISOString())});}
function moveBooking(id,date,time) {
  const a=state.appointments.find(b=>b.id===id);if(!a||state.mode!=="demo")return "Booking unavailable.";
  const start=Date.parse(`${date}T${time}:00+02:00`),end=start+a.duration*60000;
  if(!Number.isFinite(start)||time<"08:00"||end>Date.parse(`${date}T17:00:00+02:00`))return "Choose a time between 08:00 and 17:00, including the appointment duration.";
  const day=new Date(`${date}T12:00:00Z`).getUTCDay();if(day===0||day===6)return "This demo schedule is open Monday to Friday.";
  if(a.practitioner==="alex"&&date===today()&&start<Date.parse(`${date}T14:00:00+02:00`)&&end>Date.parse(`${date}T13:00:00+02:00`))return "Dr Alex Scott has personal time from 13:00 to 14:00.";
  if(state.appointments.some(b=>b.id!==id&&b.practitioner===a.practitioner&&b.status==="confirmed"&&Date.parse(b.startsAt)<end&&Date.parse(b.startsAt)+b.duration*60000>start))return "That practitioner already has an appointment during this time. Choose another slot.";
  const old=timeOf(a.startsAt);a.movedFrom=old;a.startsAt=`${date}T${time}:00+02:00`;a.reminder="Not recorded";
  addActivity(`${a.name.split(" ")[0]} moved to ${time}`,`${old} → ${time}. Reference ${a.reference} stays the same.`);
  addActivity("Practitioner update preview",`${practitionerName(a.practitioner)} would receive the new appointment time.`,"bell");
  state.date=date;return "";
}
function scenario() {
  if(state.mode!=="demo")return;
  openDrawer(`${drawerHeader("WHATSAPP DEMONSTRATION")}<h2 id="drawer-title">One message. Everyone updated.</h2><p class="drawer-subtitle">Watch Casey move an appointment without typing a reference.</p><div class="scenario-intro">Patient on WhatsApp<br><strong>“Can I move my 10:00 appointment to 14:00 today?”</strong></div><div class="scenario-step"><span class="step-number">1</span><div><strong>The receptionist finds the booking</strong><p>Casey Morgan · Initial consultation · C7-DEMO</p></div></div><div class="scenario-step"><span class="step-number">2</span><div><strong>The calendar changes</strong><p>The 10:00 slot reopens. The same booking moves to 14:00.</p></div></div><div class="scenario-step"><span class="step-number">3</span><div><strong>The practitioner gets an update</strong><p>A WhatsApp preview shows the old and new time.</p></div></div><div class="detail-note">This is an interactive simulation. It does not send messages or change Supabase or Google Calendar.</div><button class="button primary" data-action="run-scenario">${icon("play")}Run the demo</button>`);
}
function runScenario() {
  seed();state.date=today();state.view="calendar";state.period="day";state.filter="all";
  const error=moveBooking("casey",today(),"14:00");if(error){toast(error);return;}
  state.scenario=1;
  extraMessages.push({role:"user",text:"Can I move my 10:00 appointment to 14:00 today?",at:"09:05"},{role:"assistant",text:"Your appointment is now at 14:00. Your reference is C7-DEMO.",at:"09:05"});
  closeDrawer();render();
  openDrawer(`${drawerHeader("DEMO CHANGE COMPLETE")}<span class="badge">${icon("check")}Calendar updated</span><h2 id="drawer-title">Casey is now booked at 14:00.</h2><p class="drawer-subtitle">Same patient. Same reference. A new time.</p><div class="scenario-intro"><strong>Patient confirmation</strong><p>Your appointment is now at 14:00. Your reference is C7-DEMO.</p></div><div class="scenario-intro"><strong>Practitioner WhatsApp preview</strong><p>Last-minute change: Casey Morgan moved from 10:00 to 14:00 today.<br>Initial consultation · 45 minutes<br>Reference C7-DEMO</p></div><div class="detail-note">Both messages are previews. The calendar behind this panel reflects the change in this browser tab.</div><div class="drawer-actions"><button class="button primary" data-action="close-drawer">See the updated calendar</button><button class="button" data-action="open-inbox">View the conversation</button></div>`);
}
async function loadPilot() {
  const version=++loadVersion;
  const r=await fetch(`/dashboard/api/appointments?date=${encodeURIComponent(state.date)}`,{headers:state.token?{Authorization:`Bearer ${state.token}`}:{},credentials:"same-origin",cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error(r.status===401?"Access denied. Check the dashboard access token.":r.status===503?"The pilot connection is not configured on this server yet.":"Could not load pilot bookings. Try again.");
  const data=await r.json();if(version!==loadVersion||!state.auth)return;
  const connecting=state.mode!=="pilot";state.mode="pilot";state.appointments=data.appointments;state.lastSync=data.fetchedAt;
  if(connecting){state.filter="all";state.search="";state.status="all";}render();
}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(()=>{if(state.mode==="pilot"&&!document.hidden)loadPilot().catch(()=>toast("Pilot refresh failed. Showing the last loaded bookings."));},30000);}
async function changeDate(date) {const previous=state.date;state.date=date;if(state.mode==="pilot"){try{await loadPilot();}catch(e){state.date=previous;render();toast(e.message);}}else render();}
document.addEventListener("click",e=>{
  const target=e.target.closest("button");if(!target)return;
  if(target.dataset.view){state.view=target.dataset.view;render();}
  if(target.dataset.period){state.period=target.dataset.period;render();}
  if(target.dataset.appointment)showAppointment(target.dataset.appointment);
  if(target.dataset.reschedule)showReschedule(target.dataset.reschedule);
  if(target.dataset.cancel&&state.mode==="demo"){
    const a=state.appointments.find(b=>b.id===target.dataset.cancel);
    $("#appointment-form").innerHTML=`<div class="inline-form"><strong>Cancel ${esc(a.name)}’s demo appointment?</strong><p class="drawer-subtitle">The slot will reopen. ${esc(a.reference)} stays on the cancelled record.</p><div><button class="button danger" data-confirm-cancel="${esc(a.id)}">Yes, cancel demo booking</button><button class="button" data-action="clear-form">Keep appointment</button></div></div>`;
  }
  if(target.dataset.confirmCancel&&state.mode==="demo"){
    const a=state.appointments.find(b=>b.id===target.dataset.confirmCancel);a.status="cancelled";addActivity(`${a.name.split(" ")[0]}’s appointment cancelled`,`${a.reference} retained. The ${timeOf(a.startsAt)} slot is open again.`,"calendar");closeDrawer();render();toast("Demo booking cancelled. Its reference is retained.");
  }
  if(target.dataset.thread){state.thread=target.dataset.thread;render();}
  if(target.dataset.practitioner){state.filter=target.dataset.practitioner;state.view="calendar";state.period="day";render();}
  const action=target.dataset.action;
  if(action==="previous"||action==="next")changeDate(addDays(state.date,(action==="next"?1:-1)*(state.period==="week"?7:1)));
  if(action==="today")changeDate(today());
  if(action==="close-drawer")closeDrawer();
  if(action==="clear-form")$("#appointment-form").innerHTML="";
  if(action==="open-inbox"){closeDrawer();state.view="inbox";state.thread="casey";render();}
  if(action==="takeover"&&state.mode==="demo"){state.takeover=!state.takeover;render();if(state.takeover)$("#reply-text").focus();}
  if(action==="run-scenario")runScenario();
});
document.addEventListener("change",e=>{
  if(e.target.id==="calendar-date"&&e.target.value)changeDate(e.target.value);
  if(e.target.id==="practitioner-filter"){state.filter=e.target.value;render();}
  if(e.target.id==="status-filter"){state.status=e.target.value;render();}
});
document.addEventListener("input",e=>{if(e.target.id==="booking-search"){const pos=e.target.selectionStart;state.search=e.target.value;render();const input=$("#booking-search");input.focus();if(input.type!=="search")input.setSelectionRange(pos,pos);}});
document.addEventListener("submit",async e=>{
  if(e.target.id==="move-form"){
    e.preventDefault();const data=new FormData(e.target);const error=moveBooking(e.target.dataset.id,data.get("date"),data.get("time"));if(error){$("#move-error").textContent=error;return;}closeDrawer();render();toast("Demo appointment moved. The reference stays the same.");
  }
  if(e.target.id==="reply-form"){
    e.preventDefault();if(state.mode!=="demo"||!state.takeover)return;const text=$("#reply-text").value.trim();if(!text)return;extraMessages.push({role:"assistant",text,at:timeOf(new Date().toISOString()),team:true});render();$("#reply-text").focus();$(".chat-messages").scrollTop=$(".chat-messages").scrollHeight;toast("Reply added to the preview. No WhatsApp message was sent.");
  }
  if(e.target.id==="connect-form"){
    e.preventDefault();state.token=$("#access-token").value;state.auth="token";$("#access-token").value="";const button=e.target.querySelector("[type=submit]");button.disabled=true;button.textContent="Connecting…";$("#connection-error").textContent="";
    try{await loadPilot();$("#connection-panel").hidden=true;startPolling();toast("Pilot bookings connected. Read-only view.");}catch(error){state.token="";state.auth="";$("#connection-error").textContent=error.message;}finally{button.disabled=false;button.textContent="Connect";}
  }
});
$("#demo-button").addEventListener("click",scenario);
$("#reset-demo").addEventListener("click",()=>{seed();state.date=today();state.filter="all";state.search="";state.status="all";render();toast("Demo reset. Ready for a fresh walkthrough.");});
$("#connect-button").addEventListener("click",async()=>{
  const button=$("#connect-button");button.disabled=true;
  try{
    if(state.mode==="pilot"){
      await fetch("/dashboard/api/logout",{method:"POST",credentials:"same-origin",signal:AbortSignal.timeout(5000)});
      clearInterval(pollTimer);loadVersion++;state.token="";state.auth="";state.mode="demo";state.date=today();state.filter="all";seed();render();toast("Returned to fictional demo data.");return;
    }
    const status=await fetch("/dashboard/api/session",{cache:"no-store",signal:AbortSignal.timeout(5000)}).then(r=>r.json());
    if(status.localAvailable||status.authenticated){
      if(!status.authenticated){const session=await fetch("/dashboard/api/local-session",{method:"POST",credentials:"same-origin",signal:AbortSignal.timeout(5000)});if(!session.ok)throw new Error("Could not open a local pilot session.");}
      state.auth="session";await loadPilot();startPolling();toast("Connected to Meridian’s stored bookings.");return;
    }
    $("#connection-panel").hidden=!$("#connection-panel").hidden;if(!$("#connection-panel").hidden)$("#access-token").focus();
  }catch(error){toast(error.message||"Could not connect to the pilot.");}finally{button.disabled=false;}
});
$("#refresh-pilot").addEventListener("click",async()=>{const button=$("#refresh-pilot");button.disabled=true;try{await loadPilot();toast("Pilot bookings refreshed.");}catch(error){toast(error.message);}finally{button.disabled=false;}});
$("#close-connect").addEventListener("click",()=>{$("#connection-panel").hidden=true;$("#access-token").value="";$("#connect-button").focus();});
$("#drawer-backdrop").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{
  if($("#drawer").hidden)return;if(e.key==="Escape")closeDrawer();
  if(e.key==="Tab"){
    const items=[...$("#drawer").querySelectorAll("button:not(:disabled),input:not(:disabled),select,a[href]")].filter(el=>el.getClientRects().length),first=items[0],last=items.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
seed();render();
// An existing HttpOnly local session reconnects after refresh. No credential is
// placed in a URL or browser storage, and opening the demo never mints a session.
fetch("/dashboard/api/session",{cache:"no-store",signal:AbortSignal.timeout(5000)}).then(r=>r.json()).then(async status=>{if(status.authenticated&&!state.auth){state.auth="session";await loadPilot();startPolling();}}).catch(()=>{});
