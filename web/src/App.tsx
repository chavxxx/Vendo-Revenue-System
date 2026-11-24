import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Coins, Router, MapPin, Users, Receipt, BarChart3,
  Settings, LogOut, Plus, RefreshCw, Search, Wallet, Building2, CalendarDays,
  CheckCircle2, XCircle, Download, GitBranch, ArrowUpCircle, ShieldCheck, KeyRound, Edit, Trash2,
  Menu, X, Percent, Sliders
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const money = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n || 0);

const api = async (path: string, token: string, options: RequestInit = {}) => {
  const r = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err: any = new Error(data.error || "Request failed");
    err.status = r.status;
    throw err;
  }
  return data;
};

type User = { id: string; name: string; email: string; role: string };

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("vrm_token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState("Dashboard");
  const [data, setData] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState("");
  const [form, setForm] = useState<any>({});
  const [search, setSearch] = useState("");

  // Reports state
  const [reportFrom, setReportFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10));
  const [detailedReport, setDetailedReport] = useState<any>(null);

  // System updates state
  const [systemVersion, setSystemVersion] = useState<any>(null);
  const [updateStatus, setUpdateStatus] = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Expense filter
  const [expenseFilter, setExpenseFilter] = useState("ALL");

  // Mobile navigation drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Revenue share settings (percentages)
  const [shareSettings, setShareSettings] = useState({ ownerPercent: 25, employeePercent: 5, companyPercent: 70 });
  const [savingShares, setSavingShares] = useState(false);
  const [sharesSuccess, setSharesSuccess] = useState("");

  const isFinance = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN" || user?.role === "FINANCE";
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const nav = [
    ["Dashboard", LayoutDashboard],
    ["Harvesting", Coins],
    ["Vendos", Router],
    ["Locations", MapPin],
    ["Teams", Users],
    ...(isAdmin ? [["Users", Users] as const] : []),
    ["Expenses", Receipt],
    ["Employee Shares", Wallet],
    ["Reports", BarChart3],
    ["Settings", Settings]
  ] as const;

  function logout() {
    localStorage.removeItem("vrm_token");
    setToken("");
    setUser(null);
  }

  const load = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const me = await api("/me", token);
      setUser(me);
      const isFin = me.role === "SUPER_ADMIN" || me.role === "ADMIN" || me.role === "FINANCE";
      const isAdm = me.role === "SUPER_ADMIN" || me.role === "ADMIN";

      const [dash, vendos, municipalities, barangays, owners, teams, harvests, users, distributions, allocations, version, shares] = await Promise.all([
        api("/dashboard", token),
        api("/vendos", token),
        api("/municipalities", token),
        api("/barangays", token),
        api("/owners", token),
        api("/teams", token),
        api("/harvests", token),
        isAdm ? api("/users", token) : Promise.resolve([]),
        isFin ? api("/distributions", token).catch(() => []) : Promise.resolve([]),
        isFin ? api("/allocations", token).catch(() => []) : Promise.resolve([]),
        api("/system/version", token).catch(() => null),
        api("/system/settings", token).catch(() => null)
      ]);
      setData({ dash, vendos, municipalities, barangays, owners, teams, harvests, users, distributions, allocations });
      if (version) setSystemVersion(version);
      if (shares) setShareSettings(shares);
    } catch (e: any) {
      if (e.status === 401 || e.message?.toLowerCase().includes("token") || e.message?.toLowerCase().includes("authentication")) {
        logout();
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  async function saveShareSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingShares(true);
    setSharesSuccess("");
    setError("");
    try {
      const res = await api("/system/settings", token, {
        method: "POST",
        body: JSON.stringify({
          ownerPercent: Number(shareSettings.ownerPercent),
          employeePercent: Number(shareSettings.employeePercent)
        })
      });
      setShareSettings(res);
      setSharesSuccess("Revenue share percentages updated successfully.");
      setTimeout(() => setSharesSuccess(""), 4000);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingShares(false);
    }
  }

  const loadDetailedReport = async () => {
    if (!token) return;
    try {
      const rep = await api(`/reports/detailed?from=${reportFrom}&to=${reportTo}`, token);
      setDetailedReport(rep);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [token]);
  useEffect(() => {
    if (page === "Reports") loadDetailedReport();
  }, [page, reportFrom, reportTo]);

  async function checkUpdates() {
    setCheckingUpdate(true);
    setError("");
    setNotice("");
    try {
      const res = await api("/system/check-updates", token);
      setUpdateStatus(res);
      if (res.updateAvailable) {
        setNotice(`New update available: ${res.latestCommit} (${res.latestMessage})`);
      } else {
        setNotice("Your system is up to date with GitHub main branch.");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function applyUpdate() {
    if (!confirm("This will pull the latest code and restart services. Continue?")) return;
    try {
      await api("/system/apply-update", token, { method: "POST" });
      setNotice("Update initiated in background. Refresh in ~30 seconds.");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function submitLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const r = await api("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") })
      });
      localStorage.setItem("vrm_token", r.token);
      setToken(r.token);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save() {
    setError("");
    setNotice("");
    try {
      if (modal === "municipality") {
        if (form.id) {
          await api(`/municipalities/${form.id}`, token, { method: "PUT", body: JSON.stringify({ name: form.name }) });
        } else {
          await api("/municipalities", token, { method: "POST", body: JSON.stringify({ name: form.name }) });
        }
      } else if (modal === "barangay") {
        if (form.id) {
          await api(`/barangays/${form.id}`, token, { method: "PUT", body: JSON.stringify({ name: form.name, municipalityId: form.municipalityId }) });
        } else {
          await api("/barangays", token, { method: "POST", body: JSON.stringify({ name: form.name, municipalityId: form.municipalityId }) });
        }
      } else if (modal === "owner") {
        if (form.id) {
          await api(`/owners/${form.id}`, token, { method: "PUT", body: JSON.stringify({ name: form.name, phone: form.phone || null, status: form.status }) });
        } else {
          await api("/owners", token, { method: "POST", body: JSON.stringify({ name: form.name, phone: form.phone || undefined }) });
        }
      } else if (modal === "vendo") {
        const payload = {
          vlanId: Number(form.vlanId),
          name: form.name,
          barangayId: form.barangayId || null,
          ownerId: form.ownerId || null,
          ownerPercent: Number(form.ownerPercent !== undefined && form.ownerPercent !== "" ? form.ownerPercent : shareSettings.ownerPercent),
          notes: form.notes || undefined,
          status: form.status
        };
        if (form.id) {
          await api(`/vendos/${form.id}`, token, { method: "PUT", body: JSON.stringify(payload) });
        } else {
          await api("/vendos", token, { method: "POST", body: JSON.stringify(payload) });
        }
      } else if (modal === "team") {
        if (form.id) {
          await api(`/teams/${form.id}`, token, { method: "PUT", body: JSON.stringify({ name: form.name, leader: form.leader || null, status: form.status }) });
        } else {
          await api("/teams", token, { method: "POST", body: JSON.stringify({ name: form.name, leader: form.leader || undefined }) });
        }
      } else if (modal === "user") {
        if (form.id) {
          await api(`/users/${form.id}`, token, { method: "PUT", body: JSON.stringify({ name: form.name, role: form.role, status: form.status, password: form.password || undefined }) });
        } else {
          await api("/users", token, { method: "POST", body: JSON.stringify({ ...form }) });
        }
      } else if (modal === "harvest") {
        const coins = [1, 5, 10, 20]
          .map(d => ({ denomination: d, quantity: Number(form["coin" + d] || 0) }))
          .filter(x => x.quantity > 0);
        const calculatedGross = coins.reduce((s, c) => s + c.denomination * c.quantity, 0);
        const gross = coins.length > 0 ? calculatedGross : Number(form.gross || 0);
        const expenseAmt = Number(form.expense || 0);
        const expenses = expenseAmt > 0
          ? [{ category: form.expenseCategory || "Operating Expense", description: form.expenseDescription, amount: expenseAmt }]
          : [];

        await api("/harvests", token, {
          method: "POST",
          body: JSON.stringify({
            harvestedAt: form.harvestedAt ? new Date(form.harvestedAt).toISOString() : new Date().toISOString(),
            teamId: form.teamId || null,
            remarks: form.remarks || undefined,
            items: [{
              vendoId: form.vendoId,
              coins,
              gross,
              expenses
            }]
          })
        });
      } else if (modal === "allocation") {
        await api(`/distributions/${form.distributionId}/allocations`, token, {
          method: "POST",
          body: JSON.stringify({
            employeeId: form.employeeId,
            amount: Number(form.amount),
            note: form.note || undefined
          })
        });
      } else if (modal === "editDistribution") {
        await api(`/distributions/${form.id}`, token, {
          method: "PUT",
          body: JSON.stringify({
            ownerPercent: Number(form.ownerPercent),
            employeePercent: Number(form.employeePercent)
          })
        });
      } else if (modal === "changePassword") {
        if (form.newPassword !== form.confirmPassword) {
          throw new Error("New password and confirmation do not match.");
        }
        await api("/auth/change-password", token, {
          method: "POST",
          body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
        });
      }

      setModal("");
      setForm({});
      setNotice("Record saved successfully.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteRecord(type: string, id: string, name: string) {
    if (!confirm(`Are you sure you want to delete or deactivate ${name}?`)) return;
    setError(""); setNotice("");
    try {
      const res = await api(`/${type}/${id}`, token, { method: "DELETE" });
      setNotice(res.message || "Record processed successfully.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function approveHarvest(id: string) {
    setError(""); setNotice("");
    try {
      await api(`/harvests/${id}/approve`, token, { method: "POST" });
      setNotice("Harvest approved and distributions calculated.");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function rejectHarvest(id: string) {
    if (!confirm("Are you sure you want to reject this harvest transaction?")) return;
    setError(""); setNotice("");
    try {
      await api(`/harvests/${id}/reject`, token, { method: "POST" });
      setNotice("Harvest transaction rejected.");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function approveExpense(id: string) {
    try {
      await api(`/expenses/${id}/approve`, token, { method: "POST" });
      setNotice("Expense approved.");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function rejectExpense(id: string) {
    try {
      await api(`/expenses/${id}/reject`, token, { method: "POST" });
      setNotice("Expense rejected.");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  function exportCSV() {
    const list = detailedReport?.vendosSummary || [];
    const headers = ["VLAN ID", "Vendo Name", "Location", "Owner", "Harvest Count", "Gross", "Expenses", "Net", "Owner Share (25%)", "Employee Pool (5%)", "Company Share"];
    const rows = list.map((v: any) => [
      v.vlanId,
      `"${v.name.replace(/"/g, '""')}"`,
      `"${v.location.replace(/"/g, '""')}"`,
      `"${v.ownerName.replace(/"/g, '""')}"`,
      v.harvestCount,
      v.gross,
      v.expenses,
      v.net,
      v.ownerShare,
      v.employeePool,
      v.companyShare
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e: any) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vendo-revenue-report-${reportFrom}-to-${reportTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(detailedReport || data.dash, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `vendo-revenue-report-${reportFrom}-to-${reportTo}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (!token) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={submitLogin}>
          <div className="brand-mark"><Coins size={26} /></div>
          <h1>Vendo Revenue System</h1>
          <p>Sign in to your business dashboard</p>
          {error && <div className="error">{error}</div>}
          <label>Email address<input name="email" type="email" required placeholder="admin@example.com" /></label>
          <label>Password<input name="password" type="password" required placeholder="Your password" /></label>
          <button className="primary full">Sign in</button>
          <small>Initial credentials are configured in the server .env file.</small>
        </form>
      </div>
    );
  }

  const d = data.dash || {};
  const filtered = (arr: any[]) => arr?.filter(x => JSON.stringify(x).toLowerCase().includes(search.toLowerCase())) || [];

  const chartData = (data.harvests || [])
    .filter((h: any) => h.status === "APPROVED")
    .map((h: any) => {
      const gross = h.items?.reduce((s: number, i: any) => s + (i.gross || 0), 0) || 0;
      const expenses = h.items?.reduce((s: number, i: any) => s + (i.distribution?.approvedExpenses || 0), 0) || 0;
      const company = h.items?.reduce((s: number, i: any) => s + (i.distribution?.companyShare || 0), 0) || 0;
      return {
        date: new Date(h.harvestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        gross,
        expenses,
        company
      };
    })
    .reverse();

  const allExpenses = (data.harvests || []).flatMap((h: any) =>
    (h.items || []).flatMap((item: any) =>
      (item.expenses || []).map((exp: any) => ({
        ...exp,
        harvestReference: h.reference,
        harvestDate: h.harvestedAt,
        vendoVlan: item.vendo?.vlanId
      }))
    )
  );

  const filteredExpenses = allExpenses.filter((e: any) => expenseFilter === "ALL" || e.status === expenseFilter);

  return (
    <div className="app-shell">
      {/* Mobile Drawer Overlay */}
      {mobileNavOpen && <div className="sidebar-overlay" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Coins size={22} /></div>
          <div><b>Vendo Revenue</b><small>MANAGEMENT SYSTEM</small></div>
          <button className="mobile-close-btn" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="nav-label">WORKSPACE</div>
        {nav.map(([n, I]) => (
          <button key={n} onClick={() => { setPage(n); setMobileNavOpen(false); }} className={`nav-item ${page === n ? "active" : ""}`}>
            <I size={18} />{n}
          </button>
        ))}
        <div className="side-bottom">
          <div className="profile">
            <div className="avatar">{user?.name?.[0] || "A"}</div>
            <div><b>{user?.name}</b><small>{user?.role?.replace("_", " ")}</small></div>
          </div>
          <button className="nav-item" onClick={logout}><LogOut size={18} />Sign out</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
              <Menu size={22} />
            </button>
            <div>
              <div className="eyebrow">BUSINESS OVERVIEW / {page.toUpperCase()}</div>
              <h2>{page}</h2>
            </div>
          </div>
          <div className="top-actions">
            <span className="live-dot">● System online</span>
            {systemVersion && <span className="version-tag" style={{ fontSize: 11, color: "#78879e" }}>v{systemVersion.version} ({systemVersion.commit})</span>}
            <button className="icon-btn" onClick={load} title="Refresh data"><RefreshCw size={17} /></button>
            <div className="avatar">{user?.name?.[0] || "A"}</div>
          </div>
        </header>

        {error && <div className="error banner">{error}<button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="success banner">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {page === "Dashboard" && (
          <>
            <div className="welcome">
              <div>
                <h3>Welcome back, {user?.name?.split(" ")[0]}</h3>
                <p>Here is your business revenue overview.</p>
              </div>
              <div className="date-chip"><CalendarDays size={16} /> This month</div>
            </div>
            <div className="kpis">
              {[
                ["Gross collection", money(d.gross), Coins, "blue"],
                ["Operating expenses", money(d.expenses), Receipt, "orange"],
                ["Location owner shares", money(d.owner), Building2, "purple"],
                ["Employee share pool", money(d.employee), Users, "teal"],
                ["Your company share", money(d.company), Wallet, "green"],
                ["Active vendos", d.vendos || 0, Router, "slate"]
              ].map(([label, value, Icon, color]: any) => (
                <div className="kpi" key={label}>
                  <div className={`kpi-icon ${color}`}><Icon size={19} /></div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>Approved transactions</small>
                </div>
              ))}
            </div>
            <div className="grid-two">
              <section className="panel">
                <div className="panel-head">
                  <div><h3>Revenue snapshot</h3><p>Approved harvest transactions</p></div>
                  <span className="tag">Current month</span>
                </div>
                {chartData.length > 0 ? (
                  <div style={{ width: "100%", height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
                        <XAxis dataKey="date" fontSize={11} stroke="#8a95a7" />
                        <YAxis fontSize={11} stroke="#8a95a7" tickFormatter={v => `₱${v}`} />
                        <Tooltip formatter={(value: any) => [money(Number(value)), ""]} />
                        <Area type="monotone" dataKey="gross" name="Gross" stroke="#3474dc" fill="#e8f0ff" />
                        <Area type="monotone" dataKey="company" name="Company" stroke="#22965d" fill="#e4f7ec" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="chart-empty">
                    <BarChart3 size={32} />
                    <b>No approved harvest data yet</b>
                    <span>Revenue charts will populate as harvests are approved.</span>
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="panel-head"><div><h3>Quick actions</h3><p>Common operations</p></div></div>
                <div className="quick-actions">
                  <button onClick={() => { setModal("harvest"); setForm({ harvestedAt: new Date().toISOString().slice(0, 16) }); }}>
                    <Coins />Record harvest <Plus size={16} />
                  </button>
                  <button onClick={() => setModal("vendo")}><Router />Add vendo <Plus size={16} /></button>
                  <button onClick={() => setModal("municipality")}><MapPin />Add municipality <Plus size={16} /></button>
                  <button onClick={() => setPage("Reports")}><BarChart3 />View reports <span>→</span></button>
                </div>
              </section>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div><h3>Recent harvesting activity</h3><p>Latest submitted and approved collections</p></div>
                <button className="text-btn" onClick={() => setPage("Harvesting")}>View all →</button>
              </div>
              <HarvestTable
                rows={data.harvests || []}
                canApprove={isFinance}
                onApprove={approveHarvest}
                onReject={rejectHarvest}
              />
            </section>
          </>
        )}

        {page === "Vendos" && (
          <section className="panel">
            <PanelHead title="Vendo registry" desc="Manage coin-operated machines using unique VLAN IDs" action={() => { setModal("vendo"); setForm({ ownerPercent: 25 }); }} />
            <input className="search" placeholder="Search VLAN or vendo name..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>VLAN ID</th><th>Vendo name</th><th>Barangay</th><th>Municipality</th><th>Location owner</th><th>Owner %</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr>
                </thead>
                <tbody>
                  {filtered(data.vendos || []).map((v: any) => (
                    <tr key={v.id}>
                      <td><b>{v.vlanId}</b></td>
                      <td>{v.name}</td>
                      <td>{v.barangay?.name || "—"}</td>
                      <td>{v.barangay?.municipality?.name || "—"}</td>
                      <td>{v.owner?.name || "—"}</td>
                      <td>{v.ownerPercent}%</td>
                      <td><span className={`status ${v.status.toLowerCase()}`}>{v.status}</span></td>
                      {isAdmin && (
                        <td>
                          <button className="btn-action" onClick={() => { setModal("vendo"); setForm(v); }}>Edit</button>
                          <button className="btn-action danger" onClick={() => deleteRecord("vendos", v.id, `VLAN ${v.vlanId}`)}>
                            {v.status === "ACTIVE" ? "Deactivate" : "Delete"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.vendos?.length && <Empty text="No vendos registered yet. Add your first vendo to get started." />}
          </section>
        )}

        {page === "Locations" && (
          <>
            <div className="grid-two">
              <section className="panel">
                <PanelHead title="Municipalities" desc="Create and manage operating areas" action={() => setModal("municipality")} />
                {(data.municipalities || []).map((m: any) => (
                  <div className="list-row" key={m.id}>
                    <MapPin /><b>{m.name}</b>
                    <span>{m._count?.barangays || 0} barangays</span>
                    {isAdmin && (
                      <div style={{ marginLeft: 8 }}>
                        <button className="btn-action" onClick={() => { setModal("municipality"); setForm(m); }}>Edit</button>
                        <button className="btn-action danger" onClick={() => deleteRecord("municipalities", m.id, m.name)}>Delete</button>
                      </div>
                    )}
                  </div>
                ))}
                {!data.municipalities?.length && <Empty text="No municipalities yet." />}
              </section>
              <section className="panel">
                <PanelHead title="Barangays" desc="Organize vendo locations" action={() => setModal("barangay")} />
                {(data.barangays || []).map((b: any) => (
                  <div className="list-row" key={b.id}>
                    <MapPin /><b>{b.name}</b>
                    <span>{b.municipality?.name}</span>
                    {isAdmin && (
                      <div style={{ marginLeft: 8 }}>
                        <button className="btn-action" onClick={() => { setModal("barangay"); setForm(b); }}>Edit</button>
                        <button className="btn-action danger" onClick={() => deleteRecord("barangays", b.id, b.name)}>Delete</button>
                      </div>
                    )}
                  </div>
                ))}
                {!data.barangays?.length && <Empty text="No barangays yet." />}
              </section>
            </div>
            <section className="panel">
              <PanelHead title="Location owners" desc="Manage vendo installation site owners" action={() => setModal("owner")} />
              {(data.owners || []).map((o: any) => (
                <div className="list-row" key={o.id}>
                  <Users /><b>{o.name}</b>
                  <span>{o.phone ? o.phone + " • " : ""}{o._count?.vendos || 0} vendos</span>
                  {isAdmin && (
                    <div style={{ marginLeft: 8 }}>
                      <button className="btn-action" onClick={() => { setModal("owner"); setForm(o); }}>Edit</button>
                      <button className="btn-action danger" onClick={() => deleteRecord("owners", o.id, o.name)}>
                        {o.status === "ACTIVE" ? "Deactivate" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!data.owners?.length && <Empty text="No location owners yet." />}
            </section>
          </>
        )}

        {page === "Teams" && (
          <section className="panel">
            <PanelHead title="Harvesting teams" desc="Manage teams and team leaders" action={() => setModal("team")} />
            {(data.teams || []).map((t: any) => (
              <div className="list-row" key={t.id}>
                <Users /><b>{t.name}</b>
                <span>{t.leader ? `Leader: ${t.leader}` : "No team leader"}</span>
                {isAdmin && (
                  <div style={{ marginLeft: 8 }}>
                    <button className="btn-action" onClick={() => { setModal("team"); setForm(t); }}>Edit</button>
                    <button className="btn-action danger" onClick={() => deleteRecord("teams", t.id, t.name)}>
                      {t.status === "ACTIVE" ? "Deactivate" : "Delete"}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!data.teams?.length && <Empty text="No teams created yet." />}
          </section>
        )}

        {page === "Users" && (
          <section className="panel">
            <PanelHead title="User management" desc="Create system accounts and assign roles" action={() => setModal("user")} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {(data.users || []).map((u: any) => (
                    <tr key={u.id}>
                      <td><b>{u.name}</b></td>
                      <td>{u.email}</td>
                      <td><span className="tag">{u.role}</span></td>
                      <td><span className={`status ${u.status.toLowerCase()}`}>{u.status}</span></td>
                      <td>
                        <button className="btn-action" onClick={() => { setModal("user"); setForm({ ...u, password: "" }); }}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.users?.length && <Empty text="No users found." />}
          </section>
        )}

        {page === "Harvesting" && (
          <section className="panel">
            <PanelHead title="Harvest transactions" desc="Coin collections by vendo and harvesting team" action={() => { setModal("harvest"); setForm({ harvestedAt: new Date().toISOString().slice(0, 16) }); }} />
            <HarvestTable
              rows={data.harvests || []}
              canApprove={isFinance}
              onApprove={approveHarvest}
              onReject={rejectHarvest}
            />
          </section>
        )}

        {page === "Expenses" && (
          <section className="panel">
            <div className="panel-head">
              <div><h3>Expense overview</h3><p>Expenses are deducted from gross before revenue distribution.</p></div>
              <div className="filter-bar" style={{ margin: 0 }}>
                <label>
                  Filter status:
                  <select value={expenseFilter} onChange={e => setExpenseFilter(e.target.value)}>
                    <option value="ALL">All Statuses</option>
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Harvest Ref</th>
                    <th>Date</th>
                    <th>VLAN</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    {isFinance && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((exp: any) => (
                    <tr key={exp.id}>
                      <td><b>{exp.harvestReference}</b></td>
                      <td>{new Date(exp.harvestDate).toLocaleDateString()}</td>
                      <td>{exp.vendoVlan ? `VLAN ${exp.vendoVlan}` : "—"}</td>
                      <td>{exp.category}</td>
                      <td>{exp.description || "—"}</td>
                      <td><b>{money(exp.amount)}</b></td>
                      <td><span className={`status ${exp.status.toLowerCase()}`}>{exp.status}</span></td>
                      {isFinance && (
                        <td>
                          {exp.status === "PENDING" ? (
                            <div className="table-actions">
                              <button className="btn-approve" onClick={() => approveExpense(exp.id)}>Approve</button>
                              <button className="btn-reject" onClick={() => rejectExpense(exp.id)}>Reject</button>
                            </div>
                          ) : "—"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filteredExpenses.length && <Empty text="No expenses found matching the selected filter." />}
          </section>
        )}

        {page === "Employee Shares" && (
          <section className="panel">
            <div className="panel-head">
              <div><h3>Employee share pools</h3><p>Employee allocations are manual and cannot exceed the generated pool.</p></div>
            </div>
            <div className="notice" style={{ marginBottom: 16 }}>
              Financial rule: 5% of the remaining 75% after location owner distribution is reserved as an employee pool. Allocations are manually managed below.
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Harvest Item</th>
                    <th>VLAN</th>
                    <th>Gross</th>
                    <th>Net</th>
                    <th>Owner Share</th>
                    <th>Employee Pool</th>
                    <th>Allocated</th>
                    <th>Remaining Pool</th>
                    {isFinance && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {(data.distributions || []).map((dist: any) => {
                    const allocatedTotal = (dist.allocations || []).reduce((s: number, a: any) => s + a.amount, 0);
                    const remaining = dist.employeePool - allocatedTotal;
                    return (
                      <tr key={dist.id}>
                        <td><b>{dist.harvestItem?.harvest?.reference || "—"}</b></td>
                        <td>{dist.harvestItem?.vendo?.vlanId ? `VLAN ${dist.harvestItem.vendo.vlanId}` : "—"}</td>
                        <td>{money(dist.gross)}</td>
                        <td>{money(dist.netAfterExpenses)}</td>
                        <td>{money(dist.ownerShare)} <small style={{ color: "#78879e" }}>({dist.ownerPercent}%)</small></td>
                        <td><b>{money(dist.employeePool)}</b> <small style={{ color: "#78879e" }}>({dist.employeePercent}%)</small></td>
                        <td>{money(allocatedTotal)}</td>
                        <td><b style={{ color: remaining > 0 ? "#16845a" : "#8a95a7" }}>{money(remaining)}</b></td>
                        {isFinance && (
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {remaining > 0 ? (
                                <button
                                  className="primary small"
                                  onClick={() => {
                                    setModal("allocation");
                                    setForm({ distributionId: dist.id, maxAmount: remaining, amount: remaining });
                                  }}
                                >
                                  Allocate Share
                                </button>
                              ) : (
                                <span className="status">Allocated</span>
                              )}
                              <button
                                className="btn-action"
                                onClick={() => {
                                  setModal("editDistribution");
                                  setForm({
                                    id: dist.id,
                                    ownerPercent: dist.ownerPercent || 25,
                                    employeePercent: dist.employeePercent || 5
                                  });
                                }}
                                title="Adjust share percentages"
                              >
                                Edit %
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!data.distributions?.length && <Empty text="No approved distributions with employee pools yet. Approve a harvest to generate pools." />}

            {data.allocations?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4>Recorded Employee Allocations</h4>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Employee</th><th>Amount</th><th>Note</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {data.allocations.map((a: any) => (
                        <tr key={a.id}>
                          <td><b>{a.employee?.name}</b></td>
                          <td><b>{money(a.amount)}</b></td>
                          <td>{a.note || "—"}</td>
                          <td>{new Date(a.createdAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {page === "Reports" && (
          <section className="panel">
            <div className="panel-head">
              <div><h3>Financial summary & analytics</h3><p>Approved harvest revenue breakdown</p></div>
              <div className="export-group">
                <button className="primary small" onClick={exportCSV}><Download size={15} /> Export CSV</button>
                <button className="secondary" style={{ padding: "6px 12px" }} onClick={exportJSON}>Export JSON</button>
              </div>
            </div>

            <div className="filter-bar">
              <label>From: <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></label>
              <label>To: <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} /></label>
              <button className="primary small" onClick={loadDetailedReport}>Apply Date Filter</button>
            </div>

            <div className="report-grid" style={{ marginBottom: 20 }}>
              {[
                ["Gross collection", d.gross],
                ["Approved expenses", d.expenses],
                ["Net after expenses", d.net],
                ["Location owner share", d.owner],
                ["Employee pool", d.employee],
                ["Company share", d.company]
              ].map(([k, v]: any) => (
                <div className="report-item" key={k}>
                  <span>{k}</span>
                  <b>{money(v)}</b>
                </div>
              ))}
            </div>

            <h4>Vendo Revenue Breakdown</h4>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>VLAN</th>
                    <th>Vendo Name</th>
                    <th>Location</th>
                    <th>Owner</th>
                    <th>Sessions</th>
                    <th>Gross</th>
                    <th>Expenses</th>
                    <th>Net</th>
                    <th>Owner ({shareSettings.ownerPercent}%)</th>
                    <th>Employee ({shareSettings.employeePercent}%)</th>
                    <th>Company Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailedReport?.vendosSummary || []).map((v: any) => (
                    <tr key={v.vendoId}>
                      <td><b>{v.vlanId}</b></td>
                      <td>{v.name}</td>
                      <td>{v.location}</td>
                      <td>{v.ownerName}</td>
                      <td>{v.harvestCount}</td>
                      <td>{money(v.gross)}</td>
                      <td>{money(v.expenses)}</td>
                      <td><b>{money(v.net)}</b></td>
                      <td>{money(v.ownerShare)}</td>
                      <td>{money(v.employeePool)}</td>
                      <td><b style={{ color: "#198451" }}>{money(v.companyShare)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!detailedReport?.vendosSummary?.length && <Empty text="No vendo transaction data found for the selected period." />}
          </section>
        )}

        {page === "Settings" && (
          <>
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h3>System & GitHub Updates</h3>
                  <p>Check GitHub repository for application updates and patches</p>
                </div>
                <button className="primary small" onClick={checkUpdates} disabled={checkingUpdate}>
                  <RefreshCw size={15} className={checkingUpdate ? "spin" : ""} />
                  {checkingUpdate ? "Checking..." : "Check for Updates"}
                </button>
              </div>

              <div className="update-card">
                <div className="update-header">
                  <div>
                    <b style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
                      <GitBranch size={16} /> Vendo Revenue System
                    </b>
                    <small style={{ color: "#78879e", marginTop: 4, display: "block" }}>
                      Connected to GitHub: <a href={`https://github.com/${systemVersion?.repo || "chavxxx/Vendo-Revenue-System"}`} target="_blank" rel="noreferrer" style={{ color: "#2563d9" }}>{systemVersion?.repo || "chavxxx/Vendo-Revenue-System"}</a>
                    </small>
                  </div>
                  {updateStatus ? (
                    updateStatus.updateAvailable ? (
                      <span className="badge-available">● Update Available</span>
                    ) : (
                      <span className="badge-latest">✓ Up to Date</span>
                    )
                  ) : (
                    <span className="tag">Current: v{systemVersion?.version || "1.0.0"} ({systemVersion?.commit || "local"})</span>
                  )}
                </div>

                <div style={{ fontSize: 12, color: "#54647c", lineHeight: 1.6 }}>
                  <div>Current Version: <b>v{systemVersion?.version || "1.0.0"}</b></div>
                  <div>Current Git Commit: <code>{systemVersion?.commit || "local"}</code></div>
                  {updateStatus && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: updateStatus.updateAvailable ? "#fff8f2" : "#f0fbf5", borderRadius: 8 }}>
                      {updateStatus.updateAvailable ? (
                        <>
                          <div style={{ color: "#c0661a", fontWeight: 700 }}>A newer version is available on GitHub!</div>
                          <div>Latest Commit: <code>{updateStatus.latestCommit}</code> — {updateStatus.latestMessage}</div>
                          {updateStatus.latestDate && <div>Date: {new Date(updateStatus.latestDate).toLocaleString()}</div>}
                          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                            <a href={updateStatus.commitUrl} target="_blank" rel="noreferrer" className="text-btn">View on GitHub →</a>
                            {isAdmin && <button className="primary small" onClick={applyUpdate}><ArrowUpCircle size={15} /> Apply Update Now</button>}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: "#198451" }}>
                          ✓ You are running the latest version from the GitHub repository main branch.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h3>Change Password</h3>
                  <p>Update your personal account login credentials</p>
                </div>
              </div>
              <form style={{ maxWidth: 400 }} onSubmit={e => { e.preventDefault(); setModal("changePassword"); save(); }}>
                <Field label="Current Password" name="currentPassword" form={form} set={setForm} type="password" />
                <Field label="New Password (minimum 8 characters)" name="newPassword" form={form} set={setForm} type="password" />
                <Field label="Confirm New Password" name="confirmPassword" form={form} set={setForm} type="password" />
                <button className="primary" style={{ marginTop: 12 }}><KeyRound size={16} /> Update Password</button>
              </form>
            </section>

            {isAdmin && (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Percent size={18} style={{ color: "#2563d9" }} /> Revenue Share Configuration
                    </h3>
                    <p>Customize default percentage shares for location owners and employee pools</p>
                  </div>
                </div>

                <form onSubmit={saveShareSettings} style={{ maxWidth: 540 }}>
                  <div className="field-grid">
                    <div className="field">
                      <label>Default Location Owner Share (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={shareSettings.ownerPercent}
                        onChange={e => {
                          const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setShareSettings(s => ({ ...s, ownerPercent: val }));
                        }}
                        required
                      />
                      <small style={{ color: "#78879e", fontSize: 10 }}>Can also be customized per machine in the Vendo Registry.</small>
                    </div>

                    <div className="field">
                      <label>Employee Pool Share (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={shareSettings.employeePercent}
                        onChange={e => {
                          const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                          setShareSettings(s => ({ ...s, employeePercent: val }));
                        }}
                        required
                      />
                      <small style={{ color: "#78879e", fontSize: 10 }}>Calculated from residual net revenue after owner share.</small>
                    </div>
                  </div>

                  {/* Visual Breakdown Preview */}
                  <div style={{ background: "#f8faff", border: "1px solid #e1e9f4", borderRadius: 10, padding: 14, margin: "14px 0" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
                      <span>PREVIEW: NET REVENUE DISTRIBUTION (Per ₱100 Net)</span>
                      <span>Company Share: ~{Math.max(0, (100 - shareSettings.ownerPercent) - Math.round((100 - shareSettings.ownerPercent) * (shareSettings.employeePercent / 100)))}%</span>
                    </div>

                    <div style={{ height: 14, display: "flex", borderRadius: 6, overflow: "hidden", background: "#e2e8f0" }}>
                      <div style={{ width: `${shareSettings.ownerPercent}%`, background: "#3b82f6" }} title={`Owner: ${shareSettings.ownerPercent}%`} />
                      <div style={{ width: `${Math.round((100 - shareSettings.ownerPercent) * (shareSettings.employeePercent / 100))}%`, background: "#8b5cf6" }} title={`Employees: ~${Math.round((100 - shareSettings.ownerPercent) * (shareSettings.employeePercent / 100))}%`} />
                      <div style={{ flex: 1, background: "#10b981" }} title="Company Share" />
                    </div>

                    <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 11, flexWrap: "wrap" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#3b82f6", display: "inline-block" }} />
                        Location Owner: <b>{shareSettings.ownerPercent}%</b>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#8b5cf6", display: "inline-block" }} />
                        Employee Pool: <b>{shareSettings.employeePercent}%</b> (~₱{Math.round((100 - shareSettings.ownerPercent) * (shareSettings.employeePercent / 100))} per ₱100)
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: "#10b981", display: "inline-block" }} />
                        Company Share: <b>~{Math.max(0, (100 - shareSettings.ownerPercent) - Math.round((100 - shareSettings.ownerPercent) * (shareSettings.employeePercent / 100)))}%</b>
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button className="primary" disabled={savingShares}>
                      <Sliders size={16} /> {savingShares ? "Saving..." : "Save Share Settings"}
                    </button>
                    {sharesSuccess && <span style={{ fontSize: 12, color: "#198451", fontWeight: 600 }}>✓ {sharesSuccess}</span>}
                  </div>
                </form>
              </section>
            )}

            <section className="panel">
              <h3>System Accounting Rules</h3>
              <p className="muted">Default currency: PHP (₱). Whole-peso accounting. Expenses deducted from gross before distribution. Location owner: {shareSettings.ownerPercent}%. Employee pool: {shareSettings.employeePercent}% of residual. Company share: remaining net revenue. Employee share distribution: manual allocation.</p>
            </section>
          </>
        )}
      </main>

      {modal && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(""); }}>
          <form className="modal" onSubmit={e => { e.preventDefault(); save(); }}>
            <div className="modal-head">
              <h3>
                {({
                  municipality: form.id ? "Edit municipality" : "Add municipality",
                  barangay: form.id ? "Edit barangay" : "Add barangay",
                  owner: form.id ? "Edit location owner" : "Add location owner",
                  vendo: form.id ? "Edit vendo" : "Register vendo",
                  team: form.id ? "Edit harvesting team" : "Create harvesting team",
                  user: form.id ? "Edit user account" : "Create user account",
                  harvest: "Record coin harvest",
                  allocation: "Allocate employee share",
                  editDistribution: "Adjust revenue distribution shares"
                } as any)[modal]}
              </h3>
              <button type="button" onClick={() => setModal("")}>×</button>
            </div>

            {modal === "municipality" && <Field label="Municipality name" name="name" form={form} set={setForm} />}
            {modal === "barangay" && (
              <>
                <Field label="Barangay name" name="name" form={form} set={setForm} />
                <SelectField label="Municipality" name="municipalityId" form={form} set={setForm} required options={(data.municipalities || []).map((x: any) => [x.id, x.name])} />
              </>
            )}
            {modal === "owner" && (
              <>
                <Field label="Owner name" name="name" form={form} set={setForm} />
                <Field label="Contact number (optional)" name="phone" form={form} set={setForm} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "vendo" && (
              <>
                <Field label="VLAN ID" name="vlanId" form={form} set={setForm} type="number" />
                <Field label="Vendo name" name="name" form={form} set={setForm} />
                <SelectField label="Barangay (optional)" name="barangayId" form={form} set={setForm} options={(data.barangays || []).map((x: any) => [x.id, `${x.name} — ${x.municipality?.name || ""}`])} />
                <SelectField label="Location owner (optional)" name="ownerId" form={form} set={setForm} options={(data.owners || []).map((x: any) => [x.id, x.name])} />
                <Field label="Location owner percentage" name="ownerPercent" form={form} set={setForm} type="number" />
                <Field label="Notes (optional)" name="notes" form={form} set={setForm} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "team" && (
              <>
                <Field label="Team name" name="name" form={form} set={setForm} />
                <Field label="Team leader (optional)" name="leader" form={form} set={setForm} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "user" && (
              <>
                <Field label="Full name" name="name" form={form} set={setForm} />
                {!form.id && <Field label="Email" name="email" form={form} set={setForm} type="email" />}
                <Field label={form.id ? "Reset Password (leave empty to keep current)" : "Initial password (minimum 8 characters)"} name="password" form={form} set={setForm} type="password" />
                <SelectField label="Role" name="role" form={form} set={setForm} required options={["ADMIN", "ENCODER", "HARVESTER", "FINANCE"].map(x => [x, x])} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "harvest" && (
              <>
                <Field label="Harvest date and time" name="harvestedAt" form={form} set={setForm} type="datetime-local" />
                <SelectField label="Vendo / VLAN" name="vendoId" form={form} set={setForm} required options={(data.vendos || []).map((x: any) => [x.id, `VLAN ${x.vlanId} — ${x.name}`])} />
                <SelectField label="Harvesting team (optional)" name="teamId" form={form} set={setForm} options={(data.teams || []).map((x: any) => [x.id, x.name])} />
                <label style={{ fontSize: 11, fontWeight: 600, color: "#536177", marginTop: 8 }}>Coin Count Breakdown</label>
                <div className="field-grid">
                  {[1, 5, 10, 20].map(n => (
                    <Field key={n} label={`₱${n} coin quantity`} name={`coin${n}`} form={form} set={setForm} type="number" />
                  ))}
                </div>
                <Field label="Gross Amount in Pesos (leave blank if coin counts entered)" name="gross" form={form} set={setForm} type="number" />
                <h4 style={{ marginTop: 12, marginBottom: 4 }}>Expense (optional)</h4>
                <Field label="Expense amount in pesos" name="expense" form={form} set={setForm} type="number" />
                <Field label="Expense category" name="expenseCategory" form={form} set={setForm} placeholder="Fuel, meals, transport..." />
                <Field label="Description" name="expenseDescription" form={form} set={setForm} />
                <Field label="Remarks" name="remarks" form={form} set={setForm} />
              </>
            )}
            {modal === "allocation" && (
              <>
                <SelectField
                  label="Select Employee"
                  name="employeeId"
                  form={form}
                  set={setForm}
                  required
                  options={(data.users || []).map((u: any) => [u.id, `${u.name} (${u.role})`])}
                />
                <Field
                  label={`Allocation Amount in Pesos (Max: ₱${form.maxAmount || 0})`}
                  name="amount"
                  form={form}
                  set={setForm}
                  type="number"
                />
                <Field label="Note (optional)" name="note" form={form} set={setForm} placeholder="e.g. November performance share" />
              </>
            )}
            {modal === "editDistribution" && (
              <>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>
                  Customize the percentage shares for this harvest item. Whole-peso distribution amounts are recalculated immediately.
                </p>
                <Field label="Location Owner Share (%)" name="ownerPercent" form={form} set={setForm} type="number" />
                <Field label="Employee Pool Share (%)" name="employeePercent" form={form} set={setForm} type="number" />
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModal("")}>Cancel</button>
              <button className="primary">Save record</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, name, form, set, type = "text", placeholder = "" }: any) {
  return (
    <label className="field">
      {label}
      <input
        type={type}
        required={["name", "vlanId", "harvestedAt", "email", "currentPassword"].includes(name)}
        min={type === "number" ? 0 : undefined}
        value={form[name] ?? ""}
        placeholder={placeholder}
        onChange={e => set({ ...form, [name]: e.target.value })}
      />
    </label>
  );
}

function SelectField({ label, name, form, set, options, required = false }: any) {
  return (
    <label className="field">
      {label}
      <select
        required={required}
        value={form[name] ?? ""}
        onChange={e => set({ ...form, [name]: e.target.value })}
      >
        <option value="">Select...</option>
        {options.map(([v, l]: any) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function PanelHead({ title, desc, action }: any) {
  return (
    <div className="panel-head">
      <div><h3>{title}</h3><p>{desc}</p></div>
      <button className="primary small" onClick={action}><Plus size={16} /> Add new</button>
    </div>
  );
}

function Empty({ text }: any) {
  return (
    <div className="empty">
      <div className="empty-icon"><MapPin /></div>
      <b>{text}</b>
    </div>
  );
}

function HarvestTable({ rows, canApprove = false, onApprove, onReject }: any) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Harvest date</th>
            <th>Team</th>
            <th>Vendos</th>
            <th>Gross collection</th>
            <th>Status</th>
            {canApprove && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((h: any) => (
            <tr key={h.id}>
              <td><b>{h.reference}</b></td>
              <td>{new Date(h.harvestedAt).toLocaleString()}</td>
              <td>{h.team?.name || "—"}</td>
              <td>{h.items?.map((i: any) => i.vendo ? `VLAN ${i.vendo.vlanId}` : "—").join(", ") || "—"}</td>
              <td>{money(h.items?.reduce((s: number, i: any) => s + (i.gross || 0), 0) || 0)}</td>
              <td><span className={`status ${h.status.toLowerCase()}`}>{h.status}</span></td>
              {canApprove && (
                <td>
                  {h.status === "SUBMITTED" ? (
                    <div className="table-actions">
                      <button className="btn-approve" onClick={() => onApprove?.(h.id)}>Approve</button>
                      <button className="btn-reject" onClick={() => onReject?.(h.id)}>Reject</button>
                    </div>
                  ) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty text="No harvesting transactions recorded yet." />}
    </div>
  );
}
