import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, Coins, Router, MapPin, Users, Receipt, BarChart3,
  Settings, LogOut, Plus, RefreshCw, Wallet, Building2, CalendarDays,
  Download, GitBranch, ArrowUpCircle, KeyRound,
  Menu, X, Percent, Sliders, Printer, AlertTriangle, Upload, Banknote, Sparkles, Eye
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const money = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(n || 0);

const vendoLabel = (v: any) =>
  v?.ipAddress ? v.ipAddress : (v?.vlanId ? `VLAN ${v.vlanId}` : "No IP");

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

// Client-side image compression for logos and deposit slips
function compressImage(file: File, maxWidth = 900, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable"));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Invalid image file"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

const PERM_LABELS: [string, string][] = [
  ["viewDashboard", "View Dashboard"],
  ["encodeHarvest", "Encode Harvest"],
  ["editHarvest", "Edit Harvest"],
  ["approveHarvest", "Approve / Reject"],
  ["manageVendos", "Manage Vendos"],
  ["manageLocations", "Manage Locations"],
  ["manageTeams", "Manage Teams"],
  ["manageExpenses", "Add Expenses"],
  ["manageRemittances", "Record Remittances"],
  ["viewReports", "View & Print Reports"],
  ["manageUsers", "Manage Users"],
  ["manageSettings", "System Settings"]
];

const ROLE_DEFAULTS: Record<string, Record<string, boolean>> = {
  ADMIN: Object.fromEntries(PERM_LABELS.map(([k]) => [k, true])),
  FINANCE: {
    viewDashboard: true, encodeHarvest: false, editHarvest: false, approveHarvest: true,
    manageVendos: false, manageLocations: false, manageTeams: false, manageExpenses: true,
    manageRemittances: true, viewReports: true, manageUsers: false, manageSettings: false
  },
  ENCODER: {
    viewDashboard: true, encodeHarvest: true, editHarvest: false, approveHarvest: false,
    manageVendos: true, manageLocations: false, manageTeams: false, manageExpenses: true,
    manageRemittances: false, viewReports: false, manageUsers: false, manageSettings: false
  },
  HARVESTER: {
    viewDashboard: true, encodeHarvest: true, editHarvest: false, approveHarvest: false,
    manageVendos: false, manageLocations: false, manageTeams: false, manageExpenses: true,
    manageRemittances: true, viewReports: false, manageUsers: false, manageSettings: false
  }
};

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("vrm_token") || "");
  const [user, setUser] = useState<any>(null);
  const [page, setPage] = useState("Dashboard");
  const [data, setData] = useState<any>({
    dashboard: {}, vendos: [], municipalities: [], barangays: [], owners: [],
    teams: [], harvests: [], users: [], distributions: [], allocations: [],
    expenses: [], remittances: [], monthlyStatus: null
  });
  const [modal, setModal] = useState("");
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  // Branding state (editable logo & company name)
  const [branding, setBranding] = useState<{ companyName: string; companyLogo: string }>({
    companyName: "Vendo Revenue",
    companyLogo: ""
  });
  const [savingBranding, setSavingBranding] = useState(false);

  // Dashboard filters
  const defaultFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);
  const [dashFrom, setDashFrom] = useState(defaultFrom);
  const [dashTo, setDashTo] = useState(defaultTo);
  const [dashMunicipalityId, setDashMunicipalityId] = useState("");
  const [dashTeamId, setDashTeamId] = useState("");

  // Harvesting filters
  const [harvestFrom, setHarvestFrom] = useState("");
  const [harvestTo, setHarvestTo] = useState("");
  const [harvestTeamId, setHarvestTeamId] = useState("");
  const [harvestMunicipalityId, setHarvestMunicipalityId] = useState("");

  // Vendo municipality filter
  const [vendoMunicipalityId, setVendoMunicipalityId] = useState("");

  // Expense filters
  const [expenseFilter, setExpenseFilter] = useState("ALL");
  const [expenseMunicipalityId, setExpenseMunicipalityId] = useState("");

  // Remittance filters & slip viewer
  const [remitType, setRemitType] = useState("");
  const [remitMunicipalityId, setRemitMunicipalityId] = useState("");
  const [remitTeamId, setRemitTeamId] = useState("");
  const [slipPreview, setSlipPreview] = useState<string>("");

  // Reports filters
  const [reportFrom, setReportFrom] = useState(defaultFrom);
  const [reportTo, setReportTo] = useState(defaultTo);
  const [reportMunicipalityId, setReportMunicipalityId] = useState("");
  const [reportTeamId, setReportTeamId] = useState("");
  const [detailedReport, setDetailedReport] = useState<any>(null);

  // System updates state
  const [systemVersion, setSystemVersion] = useState<any>(null);
  const [updateStatus, setUpdateStatus] = useState<any>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [dismissUpdateBanner, setDismissUpdateBanner] = useState(false);
  const [updatingSystem, setUpdatingSystem] = useState(false);
  const [updateProgressText, setUpdateProgressText] = useState("");
  const [updateError, setUpdateError] = useState("");

  // Mobile navigation drawer
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Revenue share settings
  const [shareSettings, setShareSettings] = useState({ ownerPercent: 25, employeePercent: 5, companyPercent: 70 });
  const [savingShares, setSavingShares] = useState(false);
  const [sharesSuccess, setSharesSuccess] = useState("");

  const hasPerm = (perm: string) => {
    if (!user) return false;
    if (user.role === "SUPER_ADMIN") return true;
    return Boolean(user.permissions?.[perm]);
  };
  const isFinance = hasPerm("approveHarvest") || user?.role === "FINANCE" || user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";

  const nav = [
    ...(hasPerm("viewDashboard") ? [["Dashboard", LayoutDashboard]] : []),
    ["Harvesting", Coins],
    ["Vendos", Router],
    ...(hasPerm("manageLocations") || isAdmin ? [["Locations", MapPin]] : []),
    ...(hasPerm("manageTeams") || isAdmin ? [["Teams", Users]] : []),
    ...(hasPerm("manageUsers") || isAdmin ? [["Users", Users]] : []),
    ["Expenses", Receipt],
    ...(hasPerm("manageRemittances") || isFinance ? [["Remittances", Banknote]] : []),
    ...(isFinance ? [["Employee Shares", Wallet]] : []),
    ...(hasPerm("viewReports") || isFinance ? [["Reports", BarChart3]] : []),
    ["Settings", Settings]
  ] as [string, any][];

  function logout() {
    localStorage.removeItem("vrm_token");
    setToken("");
    setUser(null);
    setMobileNavOpen(false);
  }

  // Load public branding on startup
  useEffect(() => {
    api("/system/branding", "").then(b => {
      if (b?.companyName) setBranding(b);
    }).catch(() => {});
  }, []);

  const loadDashboard = async (f = dashFrom, t = dashTo, m = dashMunicipalityId, tm = dashTeamId) => {
    if (!token) return;
    const qs = new URLSearchParams();
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);
    if (m) qs.set("municipalityId", m);
    if (tm) qs.set("teamId", tm);
    const dash = await api(`/dashboard?${qs.toString()}`, token);
    setData((prev: any) => ({ ...prev, dashboard: dash }));
  };

  const loadHarvests = async (f = harvestFrom, t = harvestTo, tm = harvestTeamId, m = harvestMunicipalityId) => {
    if (!token) return;
    const qs = new URLSearchParams();
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);
    if (tm) qs.set("teamId", tm);
    if (m) qs.set("municipalityId", m);
    const harvests = await api(`/harvests?${qs.toString()}`, token);
    setData((prev: any) => ({ ...prev, harvests }));
  };

  const load = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const me = await api("/me", token);
      setUser(me);
      const canFin = me.role === "SUPER_ADMIN" || me.role === "ADMIN" || me.role === "FINANCE" || me.permissions?.approveHarvest;
      const canUsers = me.role === "SUPER_ADMIN" || me.role === "ADMIN" || me.permissions?.manageUsers || canFin;

      const dashQs = new URLSearchParams();
      if (dashFrom) dashQs.set("from", dashFrom);
      if (dashTo) dashQs.set("to", dashTo);
      if (dashMunicipalityId) dashQs.set("municipalityId", dashMunicipalityId);
      if (dashTeamId) dashQs.set("teamId", dashTeamId);

      const [dash, vendos, municipalities, barangays, owners, teams, harvests, users, distributions, allocations, expenses, remittances, monthlyStatus, version, shares, brand] = await Promise.all([
        api(`/dashboard?${dashQs.toString()}`, token),
        api("/vendos", token),
        api("/municipalities", token),
        api("/barangays", token),
        api("/owners", token),
        api("/teams", token),
        api("/harvests", token),
        canUsers ? api("/users", token).catch(() => []) : Promise.resolve([]),
        canFin ? api("/distributions", token).catch(() => []) : Promise.resolve([]),
        canFin ? api("/allocations", token).catch(() => []) : Promise.resolve([]),
        api("/expenses", token).catch(() => []),
        api("/remittances", token).catch(() => []),
        api("/vendos/monthly-status", token).catch(() => null),
        api("/system/version", token).catch(() => null),
        api("/system/settings", token).catch(() => null),
        api("/system/branding", "").catch(() => null)
      ]);
      if (version) setSystemVersion(version);
      if (shares) setShareSettings(shares);
      if (brand) setBranding(brand);
      setData({
        dashboard: dash, vendos, municipalities, barangays, owners, teams,
        harvests, users, distributions, allocations, expenses, remittances, monthlyStatus
      });
    } catch (e: any) {
      if (e.status === 401) logout();
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const loadDetailedReport = async () => {
    if (!token) return;
    try {
      const qs = new URLSearchParams();
      if (reportFrom) qs.set("from", reportFrom);
      if (reportTo) qs.set("to", reportTo);
      if (reportMunicipalityId) qs.set("municipalityId", reportMunicipalityId);
      if (reportTeamId) qs.set("teamId", reportTeamId);
      const rep = await api(`/reports/detailed?${qs.toString()}`, token);
      setDetailedReport(rep);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [token]);
  useEffect(() => {
    if (page === "Reports") loadDetailedReport();
  }, [page, reportFrom, reportTo, reportMunicipalityId, reportTeamId]);

  async function checkUpdates(silent = false) {
    if (!silent) {
      setCheckingUpdate(true);
      setError("");
      setNotice("");
    }
    try {
      const res = await api("/system/check-updates", token);
      setUpdateStatus(res);
      if (!silent) {
        if (res.updateAvailable) {
          setNotice(`New update available on GitHub: ${res.latestCommit} (${res.latestMessage})`);
        } else {
          setNotice("Your system is up to date with GitHub main branch.");
        }
      }
    } catch (e: any) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setCheckingUpdate(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    checkUpdates(true);
    const timer = setInterval(() => checkUpdates(true), 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [token]);

  async function applyUpdate() {
    if (!confirm("This will pull the latest code from GitHub, apply database schema changes, and reload the application. Continue?")) return;
    setUpdatingSystem(true);
    setUpdateProgressText("Contacting server to initiate GitHub update...");
    setUpdateError("");

    try {
      await api("/system/apply-update", token, { method: "POST" });
      setUpdateProgressText("Pulling latest code from GitHub and syncing database schema... (~15-30s)");

      let attempts = 0;
      const maxAttempts = 35;
      const pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > 5) {
          setUpdateProgressText(`Reloading application services... (attempt ${attempts}/${maxAttempts})`);
        }
        try {
          const v = await fetch("/api/system/version", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (v.ok) {
            const d = await v.json();
            clearInterval(pollInterval);
            setUpdateProgressText(`Update successfully applied! System is now on commit ${d.commit}. Reloading...`);
            setTimeout(() => window.location.reload(), 1200);
          }
        } catch {}

        if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setUpdateProgressText("");
          setUpdateError("The update was initiated, but the server took longer than expected to reload. Please refresh the page manually.");
        }
      }, 2500);
    } catch (e: any) {
      setUpdateProgressText("");
      setUpdateError("Failed to initiate update: " + e.message);
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

  async function save(e?: React.FormEvent) {
    if (e) e.preventDefault();
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
        const body = { name: form.name, phone: form.phone || undefined, status: form.status };
        if (form.id) {
          await api(`/owners/${form.id}`, token, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/owners", token, { method: "POST", body: JSON.stringify(body) });
        }
      } else if (modal === "vendo") {
        const body: any = {
          ipAddress: form.ipAddress ? String(form.ipAddress).trim() : null,
          vlanId: form.vlanId ? Number(form.vlanId) : null,
          name: form.name,
          barangayId: form.barangayId || null,
          ownerId: form.ownerId || null,
          ownerPercent: form.ownerPercent !== undefined && form.ownerPercent !== "" ? Number(form.ownerPercent) : shareSettings.ownerPercent,
          notes: form.notes,
          status: form.status
        };
        if (form.id) {
          await api(`/vendos/${form.id}`, token, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/vendos", token, { method: "POST", body: JSON.stringify(body) });
        }
      } else if (modal === "team") {
        const body = {
          name: form.name,
          leader: form.leader || undefined,
          employeePercent: form.employeePercent !== undefined && form.employeePercent !== "" ? Number(form.employeePercent) : null,
          status: form.status
        };
        if (form.id) {
          await api(`/teams/${form.id}`, token, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/teams", token, { method: "POST", body: JSON.stringify(body) });
        }
      } else if (modal === "user") {
        const body: any = {
          name: form.name,
          email: form.email,
          role: form.role || "ENCODER",
          status: form.status,
          permissions: form.permissions || undefined
        };
        if (form.password) body.password = form.password;
        if (form.id) {
          await api(`/users/${form.id}`, token, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/users", token, { method: "POST", body: JSON.stringify(body) });
        }
      } else if (modal === "harvest") {
        const coins = [1, 5, 10, 20].map(d => ({ denomination: d, quantity: Number(form[`coin${d}`] || 0) })).filter(c => c.quantity > 0);
        const gross = form.gross ? Number(form.gross) : undefined;
        const expenses = form.expense ? [{ category: form.expenseCategory || "Field Expense", description: form.expenseDescription || "", amount: Number(form.expense) }] : [];
        await api("/harvests", token, {
          method: "POST",
          body: JSON.stringify({
            harvestedAt: new Date(form.harvestedAt || Date.now()).toISOString(),
            teamId: form.teamId || null,
            remarks: form.remarks || "",
            items: [{ vendoId: form.vendoId, coins, gross, expenses }]
          })
        });
      } else if (modal === "editHarvest") {
        await api(`/harvests/${form.id}`, token, {
          method: "PUT",
          body: JSON.stringify({
            harvestedAt: form.harvestedAt ? new Date(form.harvestedAt).toISOString() : undefined,
            teamId: form.teamId || null,
            remarks: form.remarks || "",
            gross: form.gross !== undefined && form.gross !== "" ? Number(form.gross) : undefined
          })
        });
      } else if (modal === "expense") {
        await api("/expenses", token, {
          method: "POST",
          body: JSON.stringify({
            municipalityId: form.municipalityId,
            category: form.category,
            description: form.description || "",
            amount: Number(form.amount),
            incurredAt: new Date(form.incurredAt || Date.now()).toISOString()
          })
        });
      } else if (modal === "remittance") {
        await api("/remittances", token, {
          method: "POST",
          body: JSON.stringify({
            type: form.type || "BANK_DEPOSIT",
            amount: Number(form.amount),
            remittedAt: new Date(form.remittedAt || Date.now()).toISOString(),
            municipalityId: form.municipalityId || null,
            teamId: form.teamId || null,
            bankOrChannel: form.bankOrChannel || "",
            notes: form.notes || "",
            slipImage: form.slipImage || null
          })
        });
      } else if (modal === "allocation") {
        await api(`/distributions/${form.distributionId}/allocations`, token, {
          method: "POST",
          body: JSON.stringify({ employeeId: form.employeeId, amount: Number(form.amount), note: form.note || "" })
        });
      } else if (modal === "editDistribution") {
        await api(`/distributions/${form.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ ownerPercent: Number(form.ownerPercent), employeePercent: Number(form.employeePercent) })
        });
      } else if (modal === "changePassword") {
        if (form.newPassword !== form.confirmPassword) {
          throw new Error("New passwords do not match");
        }
        await api("/auth/change-password", token, {
          method: "POST",
          body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
        });
      }

      setModal("");
      setForm({});
      setNotice("Saved successfully.");
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function removeRecord(type: string, id: string, label: string) {
    if (!confirm(`Are you sure you want to delete "${label}"?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await api(`/${type}/${id}`, token, { method: "DELETE" });
      setNotice(res.message || "Record deleted.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

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
      setSharesSuccess("Default revenue share percentages saved!");
      setTimeout(() => setSharesSuccess(""), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingShares(false);
    }
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSavingBranding(true);
    setError("");
    setNotice("");
    try {
      const res = await api("/system/branding", token, {
        method: "POST",
        body: JSON.stringify({ companyName: branding.companyName, companyLogo: branding.companyLogo })
      });
      setBranding(res);
      setNotice("Company logo and name updated!");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingBranding(false);
    }
  }

  async function approveHarvest(id: string) {
    setError("");
    setNotice("");
    try {
      await api(`/harvests/${id}/approve`, token, { method: "POST" });
      setNotice("Harvest approved and financial distributions generated.");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function rejectHarvest(id: string) {
    if (!confirm("Reject this harvest submission? This cannot be undone.")) return;
    try {
      await api(`/harvests/${id}/reject`, token, { method: "POST" });
      setNotice("Harvest rejected.");
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
    if (!detailedReport?.vendosSummary?.length) return alert("No report data to export");
    const headers = ["IP Address", "VLAN ID", "Vendo Name", "Location", "Owner", "Sessions", "Gross", "Expenses", "Net", "Owner Share", "Employee Pool", "Company Share"];
    const rows = detailedReport.vendosSummary.map((r: any) => [
      r.ipAddress || "", r.vlanId || "", `"${r.name}"`, `"${r.location}"`, `"${r.ownerName}"`, r.harvestCount, r.gross, r.expenses, r.net, r.ownerShare, r.employeePool, r.companyShare
    ]);
    const csv = [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendo-report-${reportFrom}-to-${reportTo}.csv`;
    a.click();
  }

  function exportJSON() {
    if (!detailedReport) return alert("No report data to export");
    const blob = new Blob([JSON.stringify(detailedReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vendo-report-${reportFrom}-to-${reportTo}.json`;
    a.click();
  }

  const filtered = (rows: any[]) => rows.filter(r => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));

  const vendosFiltered = useMemo(() => {
    return filtered(data.vendos || []).filter((v: any) =>
      !vendoMunicipalityId || v.barangay?.municipalityId === vendoMunicipalityId
    );
  }, [data.vendos, vendoMunicipalityId, search]);

  const unallocatedTotal = useMemo(() => {
    return (data.distributions || []).reduce((acc: number, d: any) => {
      const alloc = (d.allocations || []).reduce((s: number, a: any) => s + a.amount, 0);
      return acc + (d.employeePool - alloc);
    }, 0);
  }, [data.distributions]);

  const chartData = useMemo(() => {
    const approved = (data.harvests || []).filter((h: any) => {
      if (h.status !== "APPROVED") return false;
      if (dashTeamId && h.teamId !== dashTeamId) return false;
      if (dashMunicipalityId && !h.items?.some((i: any) => i.vendo?.barangay?.municipalityId === dashMunicipalityId)) return false;
      return true;
    });
    return approved.slice(0, 15).map((h: any) => {
      const items = (h.items || []).filter((i: any) => !dashMunicipalityId || i.vendo?.barangay?.municipalityId === dashMunicipalityId);
      const gross = items.reduce((s: number, i: any) => s + (i.gross || 0), 0);
      const expenses = items.reduce((s: number, i: any) => s + (i.distribution?.approvedExpenses || 0), 0);
      const company = items.reduce((s: number, i: any) => s + (i.distribution?.companyShare || 0), 0);
      return {
        date: new Date(h.harvestedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        gross, expenses, company
      };
    }).reverse();
  }, [data.harvests, dashTeamId, dashMunicipalityId]);

  const filteredExpenses = useMemo(() => {
    return (data.expenses || []).filter((e: any) => {
      if (expenseFilter !== "ALL" && e.status !== expenseFilter) return false;
      if (expenseMunicipalityId) {
        const mId = e.municipalityId || e.harvestItem?.vendo?.barangay?.municipalityId;
        if (mId !== expenseMunicipalityId) return false;
      }
      return true;
    });
  }, [data.expenses, expenseFilter, expenseMunicipalityId]);

  const filteredRemittances = useMemo(() => {
    return (data.remittances || []).filter((r: any) => {
      if (remitType && r.type !== remitType) return false;
      if (remitMunicipalityId && r.municipalityId !== remitMunicipalityId) return false;
      if (remitTeamId && r.teamId !== remitTeamId) return false;
      return true;
    });
  }, [data.remittances, remitType, remitMunicipalityId, remitTeamId]);

  // Check if a selected vendo in Harvest modal has never been harvested before
  const selectedVendoIsNew = useMemo(() => {
    if (modal !== "harvest" || !form.vendoId) return false;
    const hasPrior = (data.harvests || []).some((h: any) =>
      h.status !== "REJECTED" && h.items?.some((i: any) => i.vendoId === form.vendoId)
    );
    return !hasPrior;
  }, [modal, form.vendoId, data.harvests]);

  if (!token) {
    return (
      <div className="login">
        <form className="login-card" onSubmit={submitLogin}>
          {branding.companyLogo ? (
            <img src={branding.companyLogo} alt={branding.companyName} style={{ width: 54, height: 54, objectFit: "contain", borderRadius: 12, display: "block", margin: "0 auto" }} />
          ) : (
            <div className="brand-mark"><Coins size={24} /></div>
          )}
          <h1>{branding.companyName}</h1>
          <p>Sign in to manage harvesting, expenses, and revenue distribution.</p>
          {error && <div className="error">{error}</div>}
          <label>Email address<input name="email" type="email" required placeholder="admin@example.com" /></label>
          <label>Password<input name="password" type="password" required placeholder="••••••••" /></label>
          <button className="primary full">Sign in to dashboard</button>
          <small>Self-hosted production system · Whole-peso PHP accounting</small>
        </form>
      </div>
    );
  }

  const d = data.dashboard || {};
  const ms = data.monthlyStatus;

  return (
    <div className="app-shell">
      {mobileNavOpen && <div className="sidebar-overlay" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand">
          {branding.companyLogo ? (
            <img src={branding.companyLogo} alt={branding.companyName} style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 10, background: "#fff", padding: 3 }} />
          ) : (
            <div className="brand-mark"><Coins size={22} /></div>
          )}
          <div><b>{branding.companyName}</b><small>MANAGEMENT SYSTEM</small></div>
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
              <div className="eyebrow">{branding.companyName.toUpperCase()} / {page.toUpperCase()}</div>
              <h2>{page}</h2>
            </div>
          </div>
          <div className="top-actions">
            <span className="live-dot">● System online</span>
            {systemVersion && <span className="version-tag" style={{ fontSize: 11, color: "#78879e" }}>v{systemVersion.version} ({systemVersion.commit})</span>}
            <button className="icon-btn" onClick={load} title="Refresh data"><RefreshCw size={17} className={busy ? "spin" : ""} /></button>
            <div className="avatar">{user?.name?.[0] || "A"}</div>
          </div>
        </header>

        {updateStatus?.updateAvailable && !dismissUpdateBanner && (
          <div className="update-banner">
            <div className="update-banner-info">
              <span className="update-badge"><ArrowUpCircle size={14} /> Update Available</span>
              <span className="update-banner-text">
                New version on GitHub (<code>{updateStatus.latestCommit}</code>: <b>{updateStatus.latestMessage}</b>)
              </span>
            </div>
            <div className="update-banner-actions">
              {isAdmin && (
                <button className="update-btn-action" onClick={applyUpdate} disabled={updatingSystem}>
                  <ArrowUpCircle size={15} /> Update from GitHub
                </button>
              )}
              <a href={updateStatus.commitUrl || `https://github.com/${systemVersion?.repo || "chavxxx/Vendo-Revenue-System"}`} target="_blank" rel="noreferrer" className="update-banner-link">
                View Changes
              </a>
              <button className="update-banner-dismiss" onClick={() => setDismissUpdateBanner(true)} title="Dismiss notice">
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {updatingSystem && (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 440, textAlign: "center", padding: "30px 22px" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#eff6ff", color: "#2563eb", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                <RefreshCw size={26} className={updateError ? "" : "spin"} />
              </div>
              <h3 style={{ margin: "0 0 8px", font: "800 18px Manrope" }}>
                {updateError ? "Update Alert" : "Updating System from GitHub"}
              </h3>
              <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px", lineHeight: 1.6 }}>
                {updateError ? updateError : updateProgressText}
              </p>
              {updateError && (
                <button className="primary" onClick={() => setUpdatingSystem(false)} style={{ margin: "0 auto" }}>Close</button>
              )}
            </div>
          </div>
        )}

        {error && <div className="error banner">{error}<button onClick={() => setError("")}>×</button></div>}
        {notice && <div className="success banner">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {page === "Dashboard" && (
          <>
            <div className="welcome">
              <div>
                <h3>Welcome back, {user?.name?.split(" ")[0]}</h3>
                <p>Filter revenue by date, municipality, or harvester team.</p>
              </div>
              <div className="date-chip"><CalendarDays size={16} /> {dashFrom} → {dashTo}</div>
            </div>

            <section className="panel" style={{ padding: "14px 16px" }}>
              <div className="filter-bar" style={{ marginBottom: 0 }}>
                <label>From: <input type="date" value={dashFrom} onChange={e => setDashFrom(e.target.value)} /></label>
                <label>To: <input type="date" value={dashTo} onChange={e => setDashTo(e.target.value)} /></label>
                <label>
                  Municipality:
                  <select value={dashMunicipalityId} onChange={e => setDashMunicipalityId(e.target.value)}>
                    <option value="">All Municipalities</option>
                    {(data.municipalities || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label>
                  Harvester:
                  <select value={dashTeamId} onChange={e => setDashTeamId(e.target.value)}>
                    <option value="">All Harvesters</option>
                    {(data.teams || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.leader ? ` (${t.leader})` : ""}</option>)}
                  </select>
                </label>
                <button className="primary small" onClick={() => loadDashboard(dashFrom, dashTo, dashMunicipalityId, dashTeamId)}>Apply Filter</button>
                <button className="secondary" style={{ padding: "7px 10px", fontSize: 11 }} onClick={() => {
                  setDashFrom(defaultFrom); setDashTo(defaultTo); setDashMunicipalityId(""); setDashTeamId("");
                  loadDashboard(defaultFrom, defaultTo, "", "");
                }}>Reset</button>
              </div>
            </section>

            <div className="kpis">
              {[
                ["Gross collection", money(d.gross), Coins, "blue"],
                ["Operating expenses", money(d.expenses), Receipt, "orange"],
                ["Location owner shares", money(d.owner), Building2, "purple"],
                ["Employee share pool", money(d.employee), Users, "teal"],
                ["Your company share", money(d.company), Wallet, "green"],
                ["Remitted / Deposited", money(d.remittedTotal), Banknote, "slate"]
              ].map(([label, value, Icon, color]: any) => (
                <div className="kpi" key={label}>
                  <div className={`kpi-icon ${color}`}><Icon size={19} /></div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            {ms && (ms.unharvestedCount > 0 || ms.newThisMonthCount > 0) && (
              <div className="alert-panel">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: ms.unharvestedCount > 0 ? 12 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AlertTriangle size={18} style={{ color: "#d97706" }} />
                    <b style={{ fontSize: 13, color: "#92400e" }}>
                      Monthly Vendo Monitoring ({ms.month}): {ms.harvestedCount}/{ms.totalActive} active vendos harvested
                    </b>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {ms.unharvestedCount > 0 && (
                      <span className="badge-warn">{ms.unharvestedCount} Not Yet Harvested</span>
                    )}
                    {ms.newThisMonthCount > 0 && (
                      <span className="badge-new"><Sparkles size={11} /> {ms.newThisMonthCount} New IP/Vendo This Month</span>
                    )}
                  </div>
                </div>
                {ms.unharvested?.length > 0 && (
                  <>
                    <p style={{ margin: "0 0 10px", fontSize: 11, color: "#92400e" }}>
                      Active vendos with no encoded harvest this month (sorted by highest previous harvest so you can remote-check the IP):
                    </p>
                    <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
                    <div className="table-wrap" style={{ background: "#fff", borderRadius: 8, border: "1px solid #fde68a" }}>
                      <table>
                        <thead>
                          <tr><th>IP / ID</th><th>Vendo Name</th><th>Municipality</th><th>Last Harvest</th><th>Last Gross</th></tr>
                        </thead>
                        <tbody>
                          {ms.unharvested.slice(0, 10).map((u: any) => (
                            <tr key={u.id}>
                              <td><b>{vendoLabel(u)}</b></td>
                              <td>{u.name}</td>
                              <td>{u.municipality}</td>
                              <td>{u.lastHarvestAt ? new Date(u.lastHarvestAt).toLocaleDateString() : "Never harvested"}</td>
                              <td><b style={{ color: u.lastHarvestGross > 0 ? "#b45309" : "#64748b" }}>{money(u.lastHarvestGross)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="grid-two">
              <section className="panel">
                <div className="panel-head">
                  <div><h3>Revenue snapshot</h3><p>Approved harvest transactions</p></div>
                  <span className="tag">{d.vendos || 0} Active Vendos · Cash on hand: {money(d.cashRemaining)}</span>
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
                  {hasPerm("encodeHarvest") && (
                    <button onClick={() => { setModal("harvest"); setForm({ harvestedAt: new Date().toISOString().slice(0, 16) }); }}>
                      <Coins />Record harvest <Plus size={16} />
                    </button>
                  )}
                  {hasPerm("manageRemittances") && (
                    <button onClick={() => { setModal("remittance"); setForm({ type: "BANK_DEPOSIT", remittedAt: new Date().toISOString().slice(0, 16) }); }}>
                      <Banknote />Record deposit / remit <Plus size={16} />
                    </button>
                  )}
                  {hasPerm("manageExpenses") && (
                    <button onClick={() => { setModal("expense"); setForm({ incurredAt: new Date().toISOString().slice(0, 10) }); }}>
                      <Receipt />Add area expense <Plus size={16} />
                    </button>
                  )}
                  {hasPerm("viewReports") && (
                    <button onClick={() => setPage("Reports")}><BarChart3 />View & Print Reports <span>→</span></button>
                  )}
                </div>
              </section>
            </div>
            <section className="panel">
              <div className="panel-head">
                <div><h3>Recent harvesting activity</h3><p>Latest submitted and approved collections</p></div>
                <button className="text-btn" onClick={() => setPage("Harvesting")}>View all →</button>
              </div>
              <HarvestTable
                rows={(data.harvests || []).slice(0, 15)}
                canApprove={hasPerm("approveHarvest")}
                canEdit={hasPerm("editHarvest")}
                onApprove={approveHarvest}
                onReject={rejectHarvest}
                onEdit={(h: any) => {
                  setModal("editHarvest");
                  setForm({
                    id: h.id,
                    harvestedAt: new Date(h.harvestedAt).toISOString().slice(0, 16),
                    teamId: h.teamId || "",
                    remarks: h.remarks || "",
                    gross: h.items?.[0]?.gross ?? ""
                  });
                }}
              />
            </section>
          </>
        )}

        {page === "Harvesting" && (
          <section className="panel">
            <PanelHead
              title="Harvesting sessions"
              desc="Filter by harvester, municipality, or date. New IPs this month are tagged."
              action={hasPerm("encodeHarvest") ? () => { setModal("harvest"); setForm({ harvestedAt: new Date().toISOString().slice(0, 16) }); } : null}
            />
            <div className="filter-bar">
              <label>
                Harvester:
                <select value={harvestTeamId} onChange={e => { setHarvestTeamId(e.target.value); loadHarvests(harvestFrom, harvestTo, e.target.value, harvestMunicipalityId); }}>
                  <option value="">All Harvesters</option>
                  {(data.teams || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.leader ? ` (${t.leader})` : ""}</option>)}
                </select>
              </label>
              <label>
                Municipality:
                <select value={harvestMunicipalityId} onChange={e => { setHarvestMunicipalityId(e.target.value); loadHarvests(harvestFrom, harvestTo, harvestTeamId, e.target.value); }}>
                  <option value="">All Municipalities</option>
                  {(data.municipalities || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label>From: <input type="date" value={harvestFrom} onChange={e => { setHarvestFrom(e.target.value); loadHarvests(e.target.value, harvestTo, harvestTeamId, harvestMunicipalityId); }} /></label>
              <label>To: <input type="date" value={harvestTo} onChange={e => { setHarvestTo(e.target.value); loadHarvests(harvestFrom, e.target.value, harvestTeamId, harvestMunicipalityId); }} /></label>
              {(harvestFrom || harvestTo || harvestTeamId || harvestMunicipalityId) && (
                <button className="secondary" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => {
                  setHarvestFrom(""); setHarvestTo(""); setHarvestTeamId(""); setHarvestMunicipalityId("");
                  loadHarvests("", "", "", "");
                }}>Clear</button>
              )}
            </div>
            <input className="search" placeholder="Search reference, IP, vendo name, or team..." value={search} onChange={e => setSearch(e.target.value)} />
            <HarvestTable
              rows={filtered(data.harvests || [])}
              canApprove={hasPerm("approveHarvest")}
              canEdit={hasPerm("editHarvest")}
              onApprove={approveHarvest}
              onReject={rejectHarvest}
              onEdit={(h: any) => {
                setModal("editHarvest");
                setForm({
                  id: h.id,
                  harvestedAt: new Date(h.harvestedAt).toISOString().slice(0, 16),
                  teamId: h.teamId || "",
                  remarks: h.remarks || "",
                  gross: h.items?.[0]?.gross ?? ""
                });
              }}
            />
          </section>
        )}

        {page === "Vendos" && (
          <section className="panel">
            <PanelHead
              title="Vendo registry"
              desc="Manage machines by IP Address (VLAN ID optional) and filter by municipality"
              action={hasPerm("manageVendos") ? () => { setModal("vendo"); setForm({ ownerPercent: shareSettings.ownerPercent }); } : null}
            />
            <div className="filter-bar">
              <label>
                Municipality:
                <select value={vendoMunicipalityId} onChange={e => setVendoMunicipalityId(e.target.value)}>
                  <option value="">All Municipalities ({(data.vendos || []).length})</option>
                  {(data.municipalities || []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <span className="tag">Showing {vendosFiltered.length} vendo(s)</span>
            </div>
            <input className="search" placeholder="Search IP address, VLAN, or vendo name..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>IP Address</th><th>VLAN</th><th>Vendo name</th><th>Barangay</th><th>Municipality</th><th>Location owner</th><th>Owner %</th><th>Status</th>{hasPerm("manageVendos") && <th>Actions</th>}</tr>
                </thead>
                <tbody>
                  {vendosFiltered.map((v: any) => (
                    <tr key={v.id}>
                      <td><b>{v.ipAddress || "—"}</b></td>
                      <td>{v.vlanId || "—"}</td>
                      <td>{v.name}</td>
                      <td>{v.barangay?.name || "—"}</td>
                      <td>{v.barangay?.municipality?.name || "—"}</td>
                      <td>{v.owner?.name || "—"}</td>
                      <td>{v.ownerPercent}%</td>
                      <td><span className={`status ${v.status.toLowerCase()}`}>{v.status}</span></td>
                      {hasPerm("manageVendos") && (
                        <td>
                          <button className="btn-action" onClick={() => { setModal("vendo"); setForm(v); }}>Edit</button>
                          <button className="btn-action danger" onClick={() => removeRecord("vendos", v.id, v.name)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!vendosFiltered.length && <Empty text="No vendos found for this filter." />}
          </section>
        )}

        {page === "Locations" && (
          <div className="grid-two">
            <section className="panel">
              <PanelHead title="Municipalities" desc="Operating areas" action={hasPerm("manageLocations") ? () => setModal("municipality") : null} />
              {(data.municipalities || []).map((m: any) => (
                <div className="list-row" key={m.id}>
                  <MapPin /><b>{m.name}</b>
                  <span>{m._count?.barangays || 0} barangays</span>
                  {hasPerm("manageLocations") && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-action" onClick={() => { setModal("municipality"); setForm(m); }}>Edit</button>
                      <button className="btn-action danger" onClick={() => removeRecord("municipalities", m.id, m.name)}>Del</button>
                    </div>
                  )}
                </div>
              ))}
              {!data.municipalities?.length && <Empty text="No municipalities added yet." />}
            </section>
            <section className="panel">
              <PanelHead title="Barangays & Owners" desc="Locations and revenue partners" action={hasPerm("manageLocations") ? () => setModal("barangay") : null} />
              {(data.barangays || []).map((b: any) => (
                <div className="list-row" key={b.id}>
                  <Building2 /><b>{b.name}</b>
                  <span>{b.municipality?.name} · {b._count?.vendos || 0} vendos</span>
                  {hasPerm("manageLocations") && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-action" onClick={() => { setModal("barangay"); setForm(b); }}>Edit</button>
                      <button className="btn-action danger" onClick={() => removeRecord("barangays", b.id, b.name)}>Del</button>
                    </div>
                  )}
                </div>
              ))}
              {hasPerm("manageLocations") && (
                <div style={{ marginTop: 14 }}>
                  <button className="primary small" onClick={() => setModal("owner")}><Plus size={15} /> Add location owner</button>
                </div>
              )}
              {(data.owners || []).map((o: any) => (
                <div className="list-row" key={o.id}>
                  <Users /><b>{o.name}</b>
                  <span>{o.phone || "No phone"} · {o._count?.vendos || 0} vendos</span>
                  {hasPerm("manageLocations") && (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn-action" onClick={() => { setModal("owner"); setForm(o); }}>Edit</button>
                      <button className="btn-action danger" onClick={() => removeRecord("owners", o.id, o.name)}>Del</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}

        {page === "Teams" && (
          <section className="panel">
            <PanelHead title="Harvesting teams" desc="Assign teams, leaders, and custom team share percentages" action={hasPerm("manageTeams") ? () => setModal("team") : null} />
            {(data.teams || []).map((t: any) => (
              <div className="list-row" key={t.id}>
                <Users />
                <div>
                  <b>{t.name}</b>
                  <small style={{ display: "block", color: "#64748b", fontSize: 11 }}>
                    Leader: {t.leader || "Unassigned"} · Share: <b>{t.employeePercent !== null && t.employeePercent !== undefined ? `${t.employeePercent}% (Custom)` : `${shareSettings.employeePercent}% (Default)`}</b>
                  </small>
                </div>
                <span>{t._count?.harvests || 0} harvests</span>
                {hasPerm("manageTeams") && (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="btn-action" onClick={() => { setModal("team"); setForm(t); }}>Edit</button>
                    <button className="btn-action danger" onClick={() => removeRecord("teams", t.id, t.name)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
            {!data.teams?.length && <Empty text="No teams created yet." />}
          </section>
        )}

        {page === "Users" && (
          <section className="panel">
            <PanelHead
              title="User management & Role permissions"
              desc="Create accounts and control whether each user can View, Encode, or Edit"
              action={hasPerm("manageUsers") ? () => setModal("user") : null}
            />
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access Summary</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {(data.users || []).map((u: any) => {
                    const rp = u.resolvedPermissions || {};
                    const summary = u.role === "SUPER_ADMIN"
                      ? "Full System Access"
                      : PERM_LABELS.filter(([k]) => rp[k]).map(([, lbl]) => lbl).slice(0, 3).join(", ") + (PERM_LABELS.filter(([k]) => rp[k]).length > 3 ? "..." : "");
                    return (
                      <tr key={u.id}>
                        <td><b>{u.name}</b></td>
                        <td>{u.email}</td>
                        <td><span className="tag">{u.role}</span></td>
                        <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>{summary || "View Only"}</td>
                        <td><span className={`status ${u.status.toLowerCase()}`}>{u.status}</span></td>
                        <td>
                          <button className="btn-action" onClick={() => { setModal("user"); setForm({ ...u, password: "", permissions: u.resolvedPermissions || ROLE_DEFAULTS[u.role] || {} }); }}>Edit / Permissions</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {page === "Expenses" && (
          <section className="panel">
            <PanelHead
              title="Expense overview"
              desc="Add standalone expenses per municipality or review harvest-linked deductions"
              action={hasPerm("manageExpenses") ? () => { setModal("expense"); setForm({ incurredAt: new Date().toISOString().slice(0, 10) }); } : null}
            />
            <div className="filter-bar">
              <label>
                Municipality:
                <select value={expenseMunicipalityId} onChange={e => setExpenseMunicipalityId(e.target.value)}>
                  <option value="">All Municipalities</option>
                  {(data.municipalities || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label>
                Status:
                <select value={expenseFilter} onChange={e => setExpenseFilter(e.target.value)}>
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </label>
            </div>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Municipality</th>
                    <th>Date</th>
                    <th>IP / Vendo</th>
                    <th>Category</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Status</th>
                    {hasPerm("approveHarvest") && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((e: any) => {
                    const mName = e.municipality?.name || e.harvestItem?.vendo?.barangay?.municipality?.name || "—";
                    const dt = e.incurredAt || e.harvestItem?.harvest?.harvestedAt || e.createdAt;
                    return (
                      <tr key={e.id}>
                        <td><b>{e.harvestItem?.harvest?.reference || "Area Expense"}</b></td>
                        <td>{mName}</td>
                        <td>{new Date(dt).toLocaleDateString()}</td>
                        <td>{e.harvestItem?.vendo ? vendoLabel(e.harvestItem.vendo) : "—"}</td>
                        <td>{e.category}</td>
                        <td>{e.description || "—"}</td>
                        <td><b>{money(e.amount)}</b></td>
                        <td><span className={`status ${e.status.toLowerCase()}`}>{e.status}</span></td>
                        {hasPerm("approveHarvest") && (
                          <td>
                            {e.status === "PENDING" ? (
                              <div className="table-actions">
                                <button className="btn-approve" onClick={() => approveExpense(e.id)}>Approve</button>
                                <button className="btn-reject" onClick={() => rejectExpense(e.id)}>Reject</button>
                              </div>
                            ) : "—"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!filteredExpenses.length && <Empty text="No expenses match the selected filter." />}
          </section>
        )}

        {page === "Remittances" && (
          <section className="panel">
            <PanelHead
              title="Remittances & Bank Deposits (Cash Out)"
              desc="Track where collected money goes (deposited in area bank or remitted to owner) with deposit slip photo"
              action={hasPerm("manageRemittances") ? () => { setModal("remittance"); setForm({ type: "BANK_DEPOSIT", remittedAt: new Date().toISOString().slice(0, 16) }); } : null}
            />
            <div className="report-grid" style={{ marginBottom: 16 }}>
              <div className="report-item">
                <span>Total Bank Deposits</span>
                <b>{money((data.remittances || []).filter((r: any) => r.type === "BANK_DEPOSIT").reduce((s: number, r: any) => s + r.amount, 0))}</b>
              </div>
              <div className="report-item">
                <span>Total Remitted to Owner</span>
                <b>{money((data.remittances || []).filter((r: any) => r.type === "REMIT_TO_OWNER").reduce((s: number, r: any) => s + r.amount, 0))}</b>
              </div>
              <div className="report-item">
                <span>All Recorded Outflows</span>
                <b>{money((data.remittances || []).reduce((s: number, r: any) => s + r.amount, 0))}</b>
              </div>
            </div>
            <div className="filter-bar">
              <label>
                Type:
                <select value={remitType} onChange={e => setRemitType(e.target.value)}>
                  <option value="">All Types</option>
                  <option value="BANK_DEPOSIT">Bank Deposit</option>
                  <option value="REMIT_TO_OWNER">Remit to Owner</option>
                </select>
              </label>
              <label>
                Municipality:
                <select value={remitMunicipalityId} onChange={e => setRemitMunicipalityId(e.target.value)}>
                  <option value="">All Municipalities</option>
                  {(data.municipalities || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label>
                Harvester:
                <select value={remitTeamId} onChange={e => setRemitTeamId(e.target.value)}>
                  <option value="">All Harvesters</option>
                  {(data.teams || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Ref</th><th>Date</th><th>Type</th><th>Municipality</th><th>Harvester</th><th>Bank / Channel</th><th>Amount</th><th>Slip</th><th>Recorded By</th>{isFinance && <th>Action</th>}</tr>
                </thead>
                <tbody>
                  {filteredRemittances.map((r: any) => (
                    <tr key={r.id}>
                      <td><b>{r.reference}</b></td>
                      <td>{new Date(r.remittedAt).toLocaleString()}</td>
                      <td><span className="tag">{r.type === "BANK_DEPOSIT" ? "Bank Deposit" : "Remit to Owner"}</span></td>
                      <td>{r.municipality?.name || "—"}</td>
                      <td>{r.team?.name || "—"}</td>
                      <td>{r.bankOrChannel || "—"}</td>
                      <td><b style={{ color: "#198451" }}>{money(r.amount)}</b></td>
                      <td>
                        {r.slipImage ? (
                          <button className="btn-action" onClick={() => setSlipPreview(r.slipImage)}><Eye size={14} style={{ marginRight: 4 }} />View Slip</button>
                        ) : "—"}
                      </td>
                      <td>{r.recordedBy?.name || "—"}</td>
                      {isFinance && (
                        <td>
                          <button className="btn-action danger" onClick={() => removeRecord("remittances", r.id, r.reference)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filteredRemittances.length && <Empty text="No remittances or bank deposits recorded yet." />}
          </section>
        )}

        {page === "Employee Shares" && (
          <section className="panel">
            <div className="panel-head">
              <div><h3>Employee share pools</h3><p>Manage and allocate shares using custom or team-specific percentages.</p></div>
            </div>
            <div className="notice" style={{ marginBottom: 16 }}>
              Unallocated Employee Share Pool Balance: <b>{money(unallocatedTotal)}</b>
            </div>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Harvest Item</th>
                    <th>IP / VLAN</th>
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
                        <td>{dist.harvestItem?.vendo ? vendoLabel(dist.harvestItem.vendo) : "—"}</td>
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
                                  setForm({ id: dist.id, ownerPercent: dist.ownerPercent, employeePercent: dist.employeePercent });
                                }}
                                title="Edit percentages for this item"
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
            {!data.distributions?.length && <Empty text="No approved distributions with employee pools yet." />}

            {data.allocations?.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h4>Recorded Employee Allocations</h4>
                <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
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
            <div className="print-only">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {branding.companyLogo && <img src={branding.companyLogo} alt="" style={{ width: 44, height: 44, objectFit: "contain" }} />}
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{branding.companyName} — Financial Report</h2>
                  <small style={{ color: "#475569" }}>Period: {reportFrom} to {reportTo}</small>
                </div>
              </div>
              <small style={{ color: "#475569" }}>Printed: {new Date().toLocaleString()}</small>
            </div>

            <div className="panel-head no-print">
              <div><h3>Detailed Financial Reports</h3><p>Filter and print reports per Harvester or per Municipality</p></div>
              <div className="export-group">
                <button className="primary small" onClick={() => window.print()}><Printer size={15} /> Print Report</button>
                <button className="secondary" style={{ padding: "6px 12px" }} onClick={exportCSV}><Download size={14} /> CSV</button>
                <button className="secondary" style={{ padding: "6px 12px" }} onClick={exportJSON}>JSON</button>
              </div>
            </div>

            <div className="filter-bar no-print">
              <label>From: <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></label>
              <label>To: <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} /></label>
              <label>
                Municipality:
                <select value={reportMunicipalityId} onChange={e => setReportMunicipalityId(e.target.value)}>
                  <option value="">All Municipalities</option>
                  {(data.municipalities || []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label>
                Harvester:
                <select value={reportTeamId} onChange={e => setReportTeamId(e.target.value)}>
                  <option value="">All Harvesters</option>
                  {(data.teams || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <button className="primary small" onClick={loadDetailedReport}>Apply Filter</button>
            </div>

            <div className="report-grid" style={{ marginBottom: 22 }}>
              {[
                ["Gross collection", detailedReport?.summary?.gross || 0],
                ["Approved expenses", detailedReport?.summary?.expenses || 0],
                ["Net after expenses", detailedReport?.summary?.net || 0],
                ["Location owner share", detailedReport?.summary?.ownerShare || 0],
                ["Employee pool", detailedReport?.summary?.employeePool || 0],
                ["Company share", detailedReport?.summary?.companyShare || 0],
                ["Remitted / Deposited", detailedReport?.summary?.remittedTotal || 0],
                ["Cash remaining", (detailedReport?.summary?.net || 0) - (detailedReport?.summary?.remittedTotal || 0)]
              ].map(([k, v]: any) => (
                <div className="report-item" key={k}>
                  <span>{k}</span>
                  <b>{money(v)}</b>
                </div>
              ))}
            </div>

            <h4>Breakdown Per Harvester / Team</h4>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table>
                <thead>
                  <tr><th>Team</th><th>Leader</th><th>Items</th><th>Gross</th><th>Expenses</th><th>Net</th><th>Owner</th><th>Employee Pool</th><th>Company</th><th>Remitted</th></tr>
                </thead>
                <tbody>
                  {(detailedReport?.harvesterSummary || []).map((h: any) => (
                    <tr key={h.teamId}>
                      <td><b>{h.teamName}</b></td>
                      <td>{h.leader}</td>
                      <td>{h.harvestCount}</td>
                      <td>{money(h.gross)}</td>
                      <td>{money(h.expenses)}</td>
                      <td><b>{money(h.net)}</b></td>
                      <td>{money(h.ownerShare)}</td>
                      <td>{money(h.employeePool)}</td>
                      <td><b style={{ color: "#198451" }}>{money(h.companyShare)}</b></td>
                      <td>{money(h.remittedTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4>Breakdown Per Municipality</h4>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap" style={{ marginBottom: 20 }}>
              <table>
                <thead>
                  <tr><th>Municipality</th><th>Items</th><th>Gross</th><th>Expenses</th><th>Net</th><th>Owner</th><th>Employee Pool</th><th>Company</th><th>Remitted</th></tr>
                </thead>
                <tbody>
                  {(detailedReport?.municipalitySummary || []).map((m: any) => (
                    <tr key={m.municipalityId}>
                      <td><b>{m.municipalityName}</b></td>
                      <td>{m.harvestCount}</td>
                      <td>{money(m.gross)}</td>
                      <td>{money(m.expenses)}</td>
                      <td><b>{money(m.net)}</b></td>
                      <td>{money(m.ownerShare)}</td>
                      <td>{money(m.employeePool)}</td>
                      <td><b style={{ color: "#198451" }}>{money(m.companyShare)}</b></td>
                      <td>{money(m.remittedTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4>Vendo Revenue Breakdown</h4>
            <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>IP / VLAN</th>
                    <th>Vendo Name</th>
                    <th>Location</th>
                    <th>Owner</th>
                    <th>Sessions</th>
                    <th>Gross</th>
                    <th>Expenses</th>
                    <th>Net</th>
                    <th>Owner Share</th>
                    <th>Employee Pool</th>
                    <th>Company Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailedReport?.vendosSummary || []).map((v: any) => (
                    <tr key={v.vendoId}>
                      <td><b>{v.ipAddress && v.ipAddress !== "—" ? v.ipAddress : (v.vlanId ? `VLAN ${v.vlanId}` : "—")}</b></td>
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
            {hasPerm("manageSettings") && (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Company Branding (Logo & Name)</h3>
                    <p>Customize the business name and logo shown in the sidebar, login page, and printed reports</p>
                  </div>
                </div>
                <form onSubmit={saveBranding} style={{ maxWidth: 460 }}>
                  <div className="field">
                    <label>Business / System Name</label>
                    <input
                      value={branding.companyName}
                      onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))}
                      required
                      placeholder="e.g. PisoWifi Revenue Corp"
                    />
                  </div>
                  <div className="field">
                    <label>Company Logo (PNG/JPG)</label>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      {branding.companyLogo && (
                        <img src={branding.companyLogo} alt="Logo preview" style={{ width: 52, height: 52, objectFit: "contain", borderRadius: 8, border: "1px solid #dfe5ee", padding: 4 }} />
                      )}
                      <label className="secondary" style={{ cursor: "pointer", padding: "8px 12px" }}>
                        <Upload size={14} /> Choose Logo Image
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={async e => {
                            const f = e.target.files?.[0];
                            if (f) {
                              const dataUrl = await compressImage(f, 360, 0.85);
                              setBranding(b => ({ ...b, companyLogo: dataUrl }));
                            }
                          }}
                        />
                      </label>
                      {branding.companyLogo && (
                        <button type="button" className="btn-action danger" onClick={() => setBranding(b => ({ ...b, companyLogo: "" }))}>Remove Logo</button>
                      )}
                    </div>
                  </div>
                  <button className="primary" disabled={savingBranding} style={{ marginTop: 8 }}>
                    {savingBranding ? "Saving..." : "Save Branding"}
                  </button>
                </form>
              </section>
            )}

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h3>System & GitHub Updates</h3>
                  <p>Check GitHub repository for application updates and patches</p>
                </div>
                <button className="primary small" onClick={() => checkUpdates(false)} disabled={checkingUpdate}>
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
                    <div style={{ marginTop: 10, padding: "12px 14px", background: updateStatus.updateAvailable ? "#fff8f2" : "#f0fbf5", borderRadius: 8, border: updateStatus.updateAvailable ? "1px solid #fed7aa" : "1px solid #bbf7d0" }}>
                      {updateStatus.updateAvailable ? (
                        <>
                          <div style={{ color: "#c0661a", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>A newer version is available on GitHub!</div>
                          <div>Latest Commit: <code>{updateStatus.latestCommit}</code> — {updateStatus.latestMessage}</div>
                          {updateStatus.latestDate && <div>Date: {new Date(updateStatus.latestDate).toLocaleString()}</div>}
                          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <a href={updateStatus.commitUrl} target="_blank" rel="noreferrer" className="text-btn">View Changes on GitHub →</a>
                            {isAdmin && (
                              <button className="primary small" onClick={applyUpdate} disabled={updatingSystem}>
                                <ArrowUpCircle size={15} /> {updatingSystem ? "Updating..." : "Update Now from GitHub"}
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ color: "#198451", fontWeight: 600 }}>
                          ✓ Your system is fully up to date with the GitHub repository main branch.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <div><h3>Change Password</h3><p>Update your personal account login credentials</p></div>
              </div>
              <form style={{ maxWidth: 400 }} onSubmit={e => { e.preventDefault(); setModal("changePassword"); save(); }}>
                <Field label="Current Password" name="currentPassword" form={form} set={setForm} type="password" />
                <Field label="New Password (minimum 8 characters)" name="newPassword" form={form} set={setForm} type="password" />
                <Field label="Confirm New Password" name="confirmPassword" form={form} set={setForm} type="password" />
                <button className="primary" style={{ marginTop: 12 }}><KeyRound size={16} /> Update Password</button>
              </form>
            </section>

            {hasPerm("manageSettings") && (
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Percent size={18} style={{ color: "#2563d9" }} /> Revenue Share Configuration
                    </h3>
                    <p>Customize default percentage shares (individual teams and vendos can override these)</p>
                  </div>
                </div>

                <form onSubmit={saveShareSettings} style={{ maxWidth: 540 }}>
                  <div className="field-grid">
                    <div className="field">
                      <label>Default Location Owner Share (%)</label>
                      <input
                        type="number" min="0" max="100"
                        value={shareSettings.ownerPercent}
                        onChange={e => setShareSettings(s => ({ ...s, ownerPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Default Employee Pool Share (%)</label>
                      <input
                        type="number" min="0" max="100"
                        value={shareSettings.employeePercent}
                        onChange={e => setShareSettings(s => ({ ...s, employeePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                        required
                      />
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
          </>
        )}
      </main>

      {slipPreview && (
        <div className="modal-backdrop" onClick={() => setSlipPreview("")}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580, textAlign: "center" }}>
            <div className="modal-head">
              <h3>Deposit / Remittance Slip</h3>
              <button type="button" onClick={() => setSlipPreview("")}>×</button>
            </div>
            <img src={slipPreview} alt="Deposit slip" style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} />
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={save}>
            <div className="modal-head">
              <h3>
                {modal === "allocation" ? "Allocate Employee Share" :
                 modal === "editDistribution" ? "Edit Item Share Percentages" :
                 modal === "editHarvest" ? "Edit Harvest Record" :
                 modal === "expense" ? "Add Municipality Expense" :
                 modal === "remittance" ? "Record Bank Deposit / Remittance" :
                 (form.id ? `Edit ${modal}` : `Add ${modal}`)}
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
                <Field label="IP Address (Primary ID, e.g. 192.168.10.25)" name="ipAddress" form={form} set={setForm} required={false} placeholder="192.168.x.x" />
                <Field label="VLAN ID (optional)" name="vlanId" form={form} set={setForm} type="number" required={false} placeholder="Optional" />
                <Field label="Vendo name" name="name" form={form} set={setForm} />
                <SelectField label="Barangay (optional)" name="barangayId" form={form} set={setForm} options={(data.barangays || []).map((x: any) => [x.id, `${x.name} — ${x.municipality?.name || ""}`])} />
                <SelectField label="Location owner (optional)" name="ownerId" form={form} set={setForm} options={(data.owners || []).map((x: any) => [x.id, x.name])} />
                <Field label="Location owner percentage (%)" name="ownerPercent" form={form} set={setForm} type="number" />
                <Field label="Notes (optional)" name="notes" form={form} set={setForm} required={false} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "team" && (
              <>
                <Field label="Team name" name="name" form={form} set={setForm} />
                <Field label="Team leader (optional)" name="leader" form={form} set={setForm} required={false} />
                <Field label={`Custom Employee / Leader Share % (leave blank for default ${shareSettings.employeePercent}%)`} name="employeePercent" form={form} set={setForm} type="number" required={false} placeholder={`Default: ${shareSettings.employeePercent}%`} />
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}
              </>
            )}
            {modal === "user" && (
              <>
                <Field label="Full name" name="name" form={form} set={setForm} />
                <Field label="Email" name="email" form={form} set={setForm} type="email" />
                <Field label={form.id ? "Reset Password (leave empty to keep current)" : "Initial password (minimum 8 characters)"} name="password" form={form} set={setForm} type="password" required={!form.id} />
                <label className="field">
                  Role
                  <select
                    value={form.role || "ENCODER"}
                    onChange={e => {
                      const r = e.target.value;
                      setForm({ ...form, role: r, permissions: ROLE_DEFAULTS[r] || ROLE_DEFAULTS.HARVESTER });
                    }}
                  >
                    {["ADMIN", "FINANCE", "ENCODER", "HARVESTER"].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                {form.id && <SelectField label="Status" name="status" form={form} set={setForm} required options={["ACTIVE", "INACTIVE"].map(x => [x, x])} />}

                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Granular Permissions</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn-action" onClick={() => setForm({ ...form, permissions: { viewDashboard: true, viewReports: true } })}>View Only</button>
                      <button type="button" className="btn-action" onClick={() => setForm({ ...form, permissions: { viewDashboard: true, encodeHarvest: true, manageExpenses: true } })}>Encode Only</button>
                      <button type="button" className="btn-action" onClick={() => setForm({ ...form, permissions: ROLE_DEFAULTS[form.role || "ENCODER"] })}>Role Default</button>
                    </div>
                  </div>
                  <div className="perm-grid">
                    {PERM_LABELS.map(([k, lbl]) => {
                      const perms = form.permissions || ROLE_DEFAULTS[form.role || "ENCODER"] || {};
                      return (
                        <label className="perm-item" key={k}>
                          <input
                            type="checkbox"
                            checked={Boolean(perms[k])}
                            onChange={e => setForm({ ...form, permissions: { ...perms, [k]: e.target.checked } })}
                          />
                          {lbl}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {modal === "harvest" && (
              <>
                <Field label="Harvest date and time" name="harvestedAt" form={form} set={setForm} type="datetime-local" />
                <SelectField
                  label="Vendo (IP Address / Name)"
                  name="vendoId"
                  form={form}
                  set={setForm}
                  required
                  options={(data.vendos || []).map((x: any) => [x.id, `${vendoLabel(x)} — ${x.name} (${x.barangay?.municipality?.name || "No Area"})`])}
                />
                {selectedVendoIsNew && (
                  <div className="success" style={{ marginTop: -4, marginBottom: 10 }}>
                    <Sparkles size={13} style={{ marginRight: 5 }} />
                    <b>New Vendo / IP This Month:</b> This IP has no previous harvest records and will be tagged as <b>NEW THIS MONTH</b>.
                  </div>
                )}
                <SelectField label="Harvesting team (optional)" name="teamId" form={form} set={setForm} options={(data.teams || []).map((x: any) => [x.id, `${x.name}${x.leader ? ` (${x.leader})` : ""}`])} />
                <label style={{ fontSize: 11, fontWeight: 600, color: "#536177", marginTop: 8 }}>Coin Count Breakdown</label>
                <div className="field-grid">
                  {[1, 5, 10, 20].map(n => (
                    <Field key={n} label={`₱${n} coin quantity`} name={`coin${n}`} form={form} set={setForm} type="number" required={false} />
                  ))}
                </div>
                <Field label="Gross Amount in Pesos (leave blank if coin counts entered)" name="gross" form={form} set={setForm} type="number" required={false} />
                <h4 style={{ marginTop: 12, marginBottom: 4 }}>Expense (optional)</h4>
                <Field label="Expense amount in pesos" name="expense" form={form} set={setForm} type="number" required={false} />
                <Field label="Expense category" name="expenseCategory" form={form} set={setForm} required={false} placeholder="Fuel, meals, transport..." />
                <Field label="Description" name="expenseDescription" form={form} set={setForm} required={false} />
                <Field label="Remarks" name="remarks" form={form} set={setForm} required={false} />
              </>
            )}
            {modal === "editHarvest" && (
              <>
                <Field label="Harvest date and time" name="harvestedAt" form={form} set={setForm} type="datetime-local" />
                <SelectField label="Harvesting team" name="teamId" form={form} set={setForm} options={(data.teams || []).map((x: any) => [x.id, x.name])} />
                <Field label="Gross Amount (Pesos)" name="gross" form={form} set={setForm} type="number" />
                <Field label="Remarks" name="remarks" form={form} set={setForm} required={false} />
              </>
            )}
            {modal === "expense" && (
              <>
                <SelectField label="Municipality" name="municipalityId" form={form} set={setForm} required options={(data.municipalities || []).map((x: any) => [x.id, x.name])} />
                <Field label="Date" name="incurredAt" form={form} set={setForm} type="date" />
                <Field label="Category (e.g. Fuel, Repair, Internet, Allowance)" name="category" form={form} set={setForm} />
                <Field label="Amount (Pesos)" name="amount" form={form} set={setForm} type="number" />
                <Field label="Description / Notes (optional)" name="description" form={form} set={setForm} required={false} />
              </>
            )}
            {modal === "remittance" && (
              <>
                <SelectField
                  label="Transaction Type"
                  name="type"
                  form={form}
                  set={setForm}
                  required
                  options={[["BANK_DEPOSIT", "Bank Deposit (Area Deposit)"], ["REMIT_TO_OWNER", "Remit Cash to Owner"]]}
                />
                <Field label="Amount (Pesos)" name="amount" form={form} set={setForm} type="number" />
                <Field label="Date & Time" name="remittedAt" form={form} set={setForm} type="datetime-local" />
                <SelectField label="Municipality / Area (optional)" name="municipalityId" form={form} set={setForm} options={(data.municipalities || []).map((x: any) => [x.id, x.name])} />
                <SelectField label="Harvester / Team (optional)" name="teamId" form={form} set={setForm} options={(data.teams || []).map((x: any) => [x.id, x.name])} />
                <Field label="Bank / GCash / Reference No. (optional)" name="bankOrChannel" form={form} set={setForm} required={false} placeholder="e.g. BDO / GCash Ref #1234" />
                <div className="field">
                  <label>Deposit Slip / Proof Photo (optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (f) {
                        const dataUrl = await compressImage(f, 900, 0.78);
                        setForm({ ...form, slipImage: dataUrl });
                      }
                    }}
                  />
                  {form.slipImage && (
                    <img src={form.slipImage} alt="Preview" style={{ marginTop: 8, maxHeight: 140, objectFit: "contain", borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  )}
                </div>
                <Field label="Notes (optional)" name="notes" form={form} set={setForm} required={false} />
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
                <Field label={`Allocation Amount in Pesos (Max: ₱${form.maxAmount || 0})`} name="amount" form={form} set={setForm} type="number" />
                <Field label="Note (optional)" name="note" form={form} set={setForm} required={false} placeholder="e.g. November performance share" />
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

function Field({ label, name, form, set, type = "text", placeholder = "", required = true }: any) {
  return (
    <label className="field">
      {label}
      <input
        type={type}
        value={form[name] ?? ""}
        placeholder={placeholder}
        onChange={e => set({ ...form, [name]: e.target.value })}
        required={required && !form.id}
      />
    </label>
  );
}

function SelectField({ label, name, form, set, options, required = false }: any) {
  return (
    <label className="field">
      {label}
      <select value={form[name] ?? ""} onChange={e => set({ ...form, [name]: e.target.value })} required={required}>
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
      {action && (
        <button className="primary small" onClick={action}><Plus size={16} /> Add new</button>
      )}
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

function HarvestTable({ rows, canApprove = false, canEdit = false, onApprove, onReject, onEdit }: any) {
  return (
    <>
      <div className="mobile-scroll-hint">← Swipe horizontally to view full table →</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Harvest date</th>
              <th>Harvester / Team</th>
              <th>IP / Vendo</th>
              <th>Gross collection</th>
              <th>Status</th>
              {(canApprove || canEdit) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((h: any) => (
              <tr key={h.id}>
                <td><b>{h.reference}</b></td>
                <td>{new Date(h.harvestedAt).toLocaleString()}</td>
                <td>{h.team?.name || "—"}</td>
                <td>
                  {h.items?.map((i: any) => (
                    <span key={i.id} style={{ marginRight: 8 }}>
                      {i.vendo ? vendoLabel(i.vendo) : "—"}
                      {i.isNewVendoThisMonth && <span className="badge-new">NEW</span>}
                    </span>
                  )) || "—"}
                </td>
                <td>{money(h.items?.reduce((s: number, i: any) => s + (i.gross || 0), 0) || 0)}</td>
                <td><span className={`status ${h.status.toLowerCase()}`}>{h.status}</span></td>
                {(canApprove || canEdit) && (
                  <td>
                    <div className="table-actions">
                      {canApprove && h.status === "SUBMITTED" && (
                        <>
                          <button className="btn-approve" onClick={() => onApprove?.(h.id)}>Approve</button>
                          <button className="btn-reject" onClick={() => onReject?.(h.id)}>Reject</button>
                        </>
                      )}
                      {canEdit && h.status !== "APPROVED" && (
                        <button className="btn-action" onClick={() => onEdit?.(h)}>Edit</button>
                      )}
                      {!(canApprove && h.status === "SUBMITTED") && !(canEdit && h.status !== "APPROVED") && "—"}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text="No harvesting transactions recorded yet." />}
      </div>
    </>
  );
}
