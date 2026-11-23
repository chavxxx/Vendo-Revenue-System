import React, { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Coins, Router, MapPin, Users, Receipt, BarChart3, Settings, LogOut, Plus, RefreshCw, CheckCircle2, Search, Menu, Wallet, Building2, CalendarDays } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const money=(n:number)=>new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(n||0);
const api=async(path:string, token:string, options:RequestInit={})=>{
 const r=await fetch("/api"+path,{...options,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`} :{}),...(options.headers||{})}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok) throw new Error(data.error||"Request failed");
 return data;
};
type User={id:string,name:string,email:string,role:string};
export default function App(){
 const [token,setToken]=useState(localStorage.getItem("vrm_token")||"");
 const [user,setUser]=useState<User|null>(null);
 const [page,setPage]=useState("Dashboard");
 const [data,setData]=useState<any>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [modal,setModal]=useState("");
 const [form,setForm]=useState<any>({});
 const [search,setSearch]=useState("");
 const nav=[["Dashboard",LayoutDashboard],["Harvesting",Coins],["Vendos",Router],["Locations",MapPin],["Teams",Users],["Users",Users],["Expenses",Receipt],["Employee Shares",Wallet],["Reports",BarChart3],["Settings",Settings]] as const;
 const load=async()=>{
  if(!token)return;
  setBusy(true);setError("");
  try{
   const me=await api("/me",token);setUser(me);
   const [dash,vendos,municipalities,barangays,owners,teams,harvests,users]=await Promise.all([
    api("/dashboard",token),api("/vendos",token),api("/municipalities",token),api("/barangays",token),api("/owners",token),api("/teams",token),api("/harvests",token),me.role==="SUPER_ADMIN"||me.role==="ADMIN"?api("/users",token):Promise.resolve([])
   ]);
   setData({dash,vendos,municipalities,barangays,owners,teams,harvests,users});
  }catch(e:any){setError(e.message);if(e.message.includes("Authentication"))logout();}
  finally{setBusy(false);}
 };
 useEffect(()=>{load()},[token]);
 function logout(){localStorage.removeItem("vrm_token");setToken("");setUser(null);}
 async function submitLogin(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setError("");const fd=new FormData(e.currentTarget);try{const r=await api("/auth/login","",{method:"POST",body:JSON.stringify({email:fd.get("email"),password:fd.get("password")})});localStorage.setItem("vrm_token",r.token);setToken(r.token);}catch(e:any){setError(e.message);}}
 async function save(){
  setError("");setNotice("");
  try{
   if(modal==="municipality") await api("/municipalities",token,{method:"POST",body:JSON.stringify({name:form.name})});
   if(modal==="barangay") await api("/barangays",token,{method:"POST",body:JSON.stringify({name:form.name,municipalityId:form.municipalityId})});
   if(modal==="owner") await api("/owners",token,{method:"POST",body:JSON.stringify({name:form.name,phone:form.phone})});
   if(modal==="vendo") await api("/vendos",token,{method:"POST",body:JSON.stringify({vlanId:Number(form.vlanId),name:form.name,barangayId:form.barangayId||null,ownerId:form.ownerId||null,ownerPercent:Number(form.ownerPercent||25)})});
   if(modal==="team") await api("/teams",token,{method:"POST",body:JSON.stringify({name:form.name,leader:form.leader})});
   if(modal==="user") await api("/users",token,{method:"POST",body:JSON.stringify({...form})});
   if(modal==="harvest"){
    const coins=[1,5,10,20].map(d=>({denomination:d,quantity:Number(form["coin"+d]||0)})).filter(x=>x.quantity>0);
    const gross=coins.reduce((s,c)=>s+c.denomination*c.quantity,0);
    await api("/harvests",token,{method:"POST",body:JSON.stringify({harvestedAt:new Date(form.harvestedAt||Date.now()).toISOString(),teamId:form.teamId||null,remarks:form.remarks,items:[{vendoId:form.vendoId,coins,gross,expenses:form.expense? [{category:form.expenseCategory||"Other",description:form.expenseDescription,amount:Number(form.expense)}]:[]}]})});
   }
   setModal("");setForm({});setNotice("Record saved successfully.");await load();
  }catch(e:any){setError(e.message);}
 }
 if(!token)return <div className="login"><form className="login-card" onSubmit={submitLogin}><div className="brand-mark"><Coins size={26}/></div><h1>Vendo Revenue Manager</h1><p>Sign in to your business dashboard</p>{error&&<div className="error">{error}</div>}<label>Email address<input name="email" type="email" required placeholder="admin@example.com"/></label><label>Password<input name="password" type="password" required placeholder="Your password"/></label><button className="primary full">Sign in</button><small>Initial credentials are configured in the server .env file.</small></form></div>;
 const d=data.dash||{};
 const filtered=(arr:any[])=>arr?.filter(x=>JSON.stringify(x).toLowerCase().includes(search.toLowerCase()))||[];
 return <div className="app-shell">
  <aside className="sidebar"><div className="brand"><div className="brand-mark"><Coins size={22}/></div><div><b>Vendo Revenue</b><small>MANAGEMENT SYSTEM</small></div></div><div className="nav-label">WORKSPACE</div>{nav.map(([n,I])=><button key={n} onClick={()=>setPage(n)} className={`nav-item ${page===n?"active":""}`}><I size={18}/>{n}</button>)}<div className="side-bottom"><div className="profile"><div className="avatar">{user?.name?.[0]||"A"}</div><div><b>{user?.name}</b><small>{user?.role?.replace("_"," ")}</small></div></div><button className="nav-item" onClick={logout}><LogOut size={18}/>Sign out</button></div></aside>
  <main className="main"><header className="topbar"><div><div className="eyebrow">BUSINESS OVERVIEW / {page.toUpperCase()}</div><h2>{page}</h2></div><div className="top-actions"><span className="live-dot">● System online</span><button className="icon-btn" onClick={load}><RefreshCw size={17}/></button><div className="avatar">{user?.name?.[0]||"A"}</div></div></header>
  {error&&<div className="error banner">{error}<button onClick={()=>setError("")}>×</button></div>}{notice&&<div className="success banner">{notice}<button onClick={()=>setNotice("")}>×</button></div>}
  {page==="Dashboard"&&<><div className="welcome"><div><h3>Welcome back, {user?.name?.split(" ")[0]}</h3><p>Here is your business revenue overview.</p></div><div className="date-chip"><CalendarDays size={16}/> This month</div></div><div className="kpis">
   {[["Gross collection",money(d.gross),Coins,"blue"],["Operating expenses",money(d.expenses),Receipt,"orange"],["Location owner shares",money(d.owner),Building2,"purple"],["Employee share pool",money(d.employee),Users,"teal"],["Your company share",money(d.company),Wallet,"green"],["Active vendos",d.vendos||0,Router,"slate"]].map(([label,value,Icon,color]:any)=><div className="kpi" key={label}><div className={`kpi-icon ${color}`}><Icon size={19}/></div><span>{label}</span><strong>{value}</strong><small>Approved transactions</small></div>)}
  </div><div className="grid-two"><section className="panel"><div className="panel-head"><div><h3>Revenue snapshot</h3><p>Approved harvest transactions</p></div><span className="tag">Current month</span></div><div className="chart-empty"><BarChart3 size={32}/><b>No approved harvest data yet</b><span>Revenue charts will populate as harvests are approved.</span></div></section><section className="panel"><div className="panel-head"><div><h3>Quick actions</h3><p>Common operations</p></div></div><div className="quick-actions"><button onClick={()=>{setModal("harvest");setForm({harvestedAt:new Date().toISOString().slice(0,16)})}}><Coins/>Record harvest <Plus size={16}/></button><button onClick={()=>setModal("vendo")}><Router/>Add vendo <Plus size={16}/></button><button onClick={()=>setModal("municipality")}><MapPin/>Add municipality <Plus size={16}/></button><button onClick={()=>setPage("Reports")}><BarChart3/>View reports <span>→</span></button></div></section></div><section className="panel"><div className="panel-head"><div><h3>Recent harvesting activity</h3><p>Latest submitted and approved collections</p></div><button className="text-btn" onClick={()=>setPage("Harvesting")}>View all →</button></div><HarvestTable rows={data.harvests||[]}/></section></>}
  {page==="Vendos"&&<section className="panel"><PanelHead title="Vendo registry" desc="Manage coin-operated machines using unique VLAN IDs" action={()=>{setModal("vendo");setForm({ownerPercent:25})}}/><input className="search" placeholder="Search VLAN or vendo name..." value={search} onChange={e=>setSearch(e.target.value)}/><table><thead><tr><th>VLAN ID</th><th>Vendo name</th><th>Barangay</th><th>Municipality</th><th>Location owner</th><th>Owner %</th><th>Status</th></tr></thead><tbody>{filtered(data.vendos).map(v=><tr key={v.id}><td><b>{v.vlanId}</b></td><td>{v.name}</td><td>{v.barangay?.name||"—"}</td><td>{v.barangay?.municipality?.name||"—"}</td><td>{v.owner?.name||"—"}</td><td>{v.ownerPercent}%</td><td><span className="status">{v.status}</span></td></tr>)}</tbody></table>{!data.vendos?.length&&<Empty text="No vendos registered yet. Add your first vendo to get started."/>}</section>}
  {page==="Locations"&&<><div className="grid-two"><section className="panel"><PanelHead title="Municipalities" desc="Create and manage operating areas" action={()=>setModal("municipality")}/>{(data.municipalities||[]).map((m:any)=><div className="list-row" key={m.id}><MapPin/><b>{m.name}</b><span>{m._count?.barangays||0} barangays</span></div>)}{!data.municipalities?.length&&<Empty text="No municipalities yet."/ >}</section><section className="panel"><PanelHead title="Barangays" desc="Organize vendo locations" action={()=>setModal("barangay")}/>{(data.barangays||[]).map((b:any)=><div className="list-row" key={b.id}><MapPin/><b>{b.name}</b><span>{b.municipality?.name}</span></div>)}{!data.barangays?.length&&<Empty text="No barangays yet."/ >}</section></div><section className="panel"><PanelHead title="Location owners" desc="Manage vendo installation site owners" action={()=>setModal("owner")}/>{(data.owners||[]).map((o:any)=><div className="list-row" key={o.id}><Users/><b>{o.name}</b><span>{o._count?.vendos||0} vendos</span></div>)}{!data.owners?.length&&<Empty text="No location owners yet."/ >}</section></>}
  {page==="Teams"&&<section className="panel"><PanelHead title="Harvesting teams" desc="Manage teams and team leaders" action={()=>setModal("team")}/>{(data.teams||[]).map((t:any)=><div className="list-row" key={t.id}><Users/><b>{t.name}</b><span>{t.leader||"No team leader assigned"}</span></div>)}{!data.teams?.length&&<Empty text="No teams created yet."/ >}</section>}
  {page==="Users"&&<section className="panel"><PanelHead title="User management" desc="Create system accounts and assign roles" action={()=>setModal("user")}/><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>{(data.users||[]).map((u:any)=><tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td><td>{u.status}</td></tr>)}</tbody></table></section>}
  {page==="Harvesting"&&<section className="panel"><PanelHead title="Harvest transactions" desc="Coin collections by vendo and harvesting team" action={()=>{setModal("harvest");setForm({harvestedAt:new Date().toISOString().slice(0,16)})}}/><HarvestTable rows={data.harvests||[]}/></section>}
  {page==="Expenses"&&<section className="panel"><div className="panel-head"><div><h3>Expense overview</h3><p>Expenses are deducted from gross before revenue distribution.</p></div></div><div className="notice">Expenses are entered as part of a harvesting record. Pending expenses do not affect approved financial calculations.</div><HarvestTable rows={data.harvests||[]}/></section>}
  {page==="Employee Shares"&&<section className="panel"><div className="panel-head"><div><h3>Employee share pools</h3><p>Employee allocations are manual and cannot exceed the generated pool.</p></div></div><div className="notice">The API supports manual allocations against approved distributions. Allocation management UI is scheduled for the next build increment.</div></section>}
  {page==="Reports"&&<section className="panel"><div className="panel-head"><div><h3>Financial summary</h3><p>Approved harvests only</p></div></div><div className="report-grid">{[["Gross collection",d.gross],["Approved expenses",d.expenses],["Net after expenses",d.net],["Location owner share",d.owner],["Employee pool",d.employee],["Company share",d.company]].map(([k,v]:any)=><div className="report-item"><span>{k}</span><b>{money(v)}</b></div>)}</div><p className="muted">Date filtering and export formats will be added in the reporting increment.</p></section>}
  {page==="Settings"&&<section className="panel"><h3>System settings</h3><p className="muted">Default currency: PHP. Whole-peso accounting. Expenses deducted from gross before distribution. Location owner: 25%. Employee pool: 5%. Employee allocations: manual.</p><div className="notice">Location and vendo registries are empty by default. No municipality or sample business data is preloaded.</div></section>}
  </main>
  {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal("")}}><form className="modal" onSubmit={e=>{e.preventDefault();save()}}><div className="modal-head"><h3>{({municipality:"Add municipality",barangay:"Add barangay",owner:"Add location owner",vendo:"Register vendo",team:"Create harvesting team",user:"Create user account",harvest:"Record coin harvest"} as any)[modal]}</h3><button type="button" onClick={()=>setModal("")}>×</button></div>
   {modal==="municipality"&&<Field label="Municipality name" name="name" form={form} set={setForm}/>}
   {modal==="barangay"&&<><Field label="Barangay name" name="name" form={form} set={setForm}/><SelectField label="Municipality" name="municipalityId" form={form} set={setForm} options={(data.municipalities||[]).map((x:any)=>[x.id,x.name])}/></>}
   {modal==="owner"&&<><Field label="Owner name" name="name" form={form} set={setForm}/><Field label="Contact number (optional)" name="phone" form={form} set={setForm}/></>}
   {modal==="vendo"&&<><Field label="VLAN ID" name="vlanId" form={form} set={setForm} type="number"/><Field label="Vendo name" name="name" form={form} set={setForm}/><SelectField label="Barangay (optional)" name="barangayId" form={form} set={setForm} options={(data.barangays||[]).map((x:any)=>[x.id,`${x.name} — ${x.municipality.name}`])}/><SelectField label="Location owner (optional)" name="ownerId" form={form} set={setForm} options={(data.owners||[]).map((x:any)=>[x.id,x.name])}/><Field label="Location owner percentage" name="ownerPercent" form={form} set={setForm} type="number"/></>}
   {modal==="team"&&<><Field label="Team name" name="name" form={form} set={setForm}/><Field label="Team leader (optional)" name="leader" form={form} set={setForm}/></>}
   {modal==="user"&&<><Field label="Full name" name="name" form={form} set={setForm}/><Field label="Email" name="email" form={form} set={setForm} type="email"/><Field label="Initial password (minimum 12 characters)" name="password" form={form} set={setForm} type="password"/><SelectField label="Role" name="role" form={form} set={setForm} options={["ADMIN","ENCODER","HARVESTER","FINANCE"].map(x=>[x,x])}/></>}
   {modal==="harvest"&&<><Field label="Harvest date and time" name="harvestedAt" form={form} set={setForm} type="datetime-local"/><SelectField label="Vendo / VLAN" name="vendoId" form={form} set={setForm} options={(data.vendos||[]).map((x:any)=>[x.id,`VLAN ${x.vlanId} — ${x.name}`])}/><SelectField label="Harvesting team (optional)" name="teamId" form={form} set={setForm} options={(data.teams||[]).map((x:any)=>[x.id,x.name])}/><div className="field-grid">{[1,5,10,20].map(n=><Field label={`₱${n} coin quantity`} name={`coin${n}`} form={form} set={setForm} type="number"/>)}</div><h4>Expense (optional)</h4><Field label="Expense amount in pesos" name="expense" form={form} set={setForm} type="number"/><Field label="Expense category" name="expenseCategory" form={form} set={setForm} placeholder="Fuel, meals, transport..."/><Field label="Description" name="expenseDescription" form={form} set={setForm}/><Field label="Remarks" name="remarks" form={form} set={setForm}/></>}
   <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setModal("")}>Cancel</button><button className="primary">Save record</button></div>
  </form></div>}
 </div>
}
function Field({label,name,form,set,type="text",placeholder=""}:any){return <label className="field">{label}<input type={type} required={["name","vlanId","harvestedAt","vendoId","email","password"].includes(name)} min={type==="number"?0:undefined} value={form[name]??""} placeholder={placeholder} onChange={e=>set({...form,[name]:e.target.value})}/></label>}
function SelectField({label,name,form,set,options}:any){return <label className="field">{label}<select value={form[name]??""} onChange={e=>set({...form,[name]:e.target.value})}><option value="">Select...</option>{options.map(([v,l]:any)=><option key={v} value={v}>{l}</option>)}</select></label>}
function PanelHead({title,desc,action}:any){return <div className="panel-head"><div><h3>{title}</h3><p>{desc}</p></div><button className="primary small" onClick={action}><Plus size={16}/> Add new</button></div>}
function Empty({text}:any){return <div className="empty"><div className="empty-icon"><MapPin/></div><b>{text}</b></div>}
function HarvestTable({rows}:any){return <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Harvest date</th><th>Team</th><th>Vendos</th><th>Gross collection</th><th>Status</th></tr></thead><tbody>{rows.map((h:any)=><tr key={h.id}><td><b>{h.reference}</b></td><td>{new Date(h.harvestedAt).toLocaleString()}</td><td>{h.team?.name||"—"}</td><td>{h.items?.map((i:any)=>`VLAN ${i.vendo.vlanId}`).join(", ")}</td><td>{money(h.items?.reduce((s:number,i:any)=>s+i.gross,0)||0)}</td><td><span className={`status ${h.status.toLowerCase()}`}>{h.status}</span></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No harvesting transactions recorded yet."/>}</div>}
