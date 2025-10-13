// src/App.jsx
import React, { useEffect, useState, useRef, useMemo } from "react";
import Scanner from "./scanner/Scanner.jsx";
import StartPage from "./StartPage.jsx";
import { io } from "socket.io-client";
import "./app.css";

// ---- API helper ----
const API_BASE = import.meta.env.VITE_API_BASE || "";
const api = (p) => (p.startsWith("/") ? `${API_BASE}${p}` : `${API_BASE}/${p}`);

// ---- QR parsing helper ----
function parseQrPayload(raw) {
  const clean = String(raw || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = clean.split(/[ ,;|:/\t\r\n]+/).filter(Boolean);

  let grade = "";
  let railType = "";
  let serial = "";
  let spec = "";
  let lengthM = "";

  const lenTok = tokens.find((t) => /^[0-9]{1,3}m$/i.test(t));
  if (lenTok) lengthM = lenTok.replace(/m/i, "");

  const gTok = tokens.find((t) => /^SAR\d{2}$/i.test(t));
  if (gTok) grade = gTok.toUpperCase();

  const tTok = tokens.find((t) => /^R\d{3}[A-Z]*$/i.test(t));
  if (tTok) railType = tTok.toUpperCase();

  const sTok = tokens.find(
    (t) => /^[A-Z0-9-]{10,22}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t)
  );
  if (sTok) serial = sTok.toUpperCase();

  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`.trim();
    if (/^[A-Z]{2,4}\s+[0-9A-Z/.\-]{3,}$/.test(pair)) {
      spec = pair.toUpperCase();
      break;
    }
  }

  if (!spec) {
    const one = tokens.find(
      (t) =>
        /^AT[A-Z0-9\-/.]{2,}$/.test(t) || /^[A-Z]{2,4}[A-Z0-9/.\-]{3,}$/.test(t)
    );
    if (one) spec = one.toUpperCase();
  }

  if (!serial) {
    const cand = tokens
      .filter((x) => /^[A-Z0-9-]{8,32}$/i.test(x))
      .sort((a, b) => b.length - a.length)[0];
    if (cand) serial = cand.toUpperCase();
  }

  return { grade, railType, serial, spec, lengthM, raw: clean };
}

export default function App() {
  const [view, setView] = useState("home");
  const [status, setStatus] = useState("Ready");
  const [scans, setScans] = useState([]);

  // Operator + 3 Wagon IDs
  const [operator, setOperator] = useState("Clerk A");
  const [wagon1Id, setWagon1Id] = useState("");
  const [wagon2Id, setWagon2Id] = useState("");
  const [wagon3Id, setWagon3Id] = useState("");

  // Pending capture (review before saving)
  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: "", railType: "", spec: "", lengthM: "" });

  // Remove confirmation
  const [removePrompt, setRemovePrompt] = useState(null);

  // Beep sound
  const beepRef = useRef(null);
  const ensureBeep = () => {
    if (!beepRef.current) {
      const dataUri =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=";
      beepRef.current = new Audio(dataUri);
    }
    try {
      beepRef.current.currentTime = 0;
      beepRef.current.play();
    } catch {}
  };

  const socketRef = useRef(null);

  // Load staged list and setup Socket.IO
  useEffect(() => {
    const fetchScans = async () => {
      try {
        const r = await fetch(api("/staged"));
        if (r.ok) setScans(await r.json());
      } catch (e) {
        console.warn("Backend not reachable:", e.message);
      }
    };
    fetchScans();

    const socket = io(API_BASE || "http://localhost:4000");
    socketRef.current = socket;

    socket.on("new-scan", (scan) => setScans((prev) => [scan, ...prev]));
    socket.on("deleted-scan", ({ id }) => setScans((prev) => prev.filter((s) => s.id !== id)));
    socket.on("cleared-scans", () => setScans([]));

    return () => socket.disconnect();
  }, []);

  const onDetected = (rawText) => {
    const parsed = parseQrPayload(rawText);
    ensureBeep();
    setPending({
      serial: parsed.serial || rawText,
      raw: parsed.raw || rawText,
      capturedAt: new Date().toISOString(),
    });
    setQrExtras({
      grade: parsed.grade,
      railType: parsed.railType,
      spec: parsed.spec,
      lengthM: parsed.lengthM,
    });
    setStatus("Captured — review & Confirm");
  };

  const discardPending = () => {
    setPending(null);
    setQrExtras({ grade: "", railType: "", spec: "", lengthM: "" });
    setWagon1Id(""); setWagon2Id(""); setWagon3Id("");
    setStatus("Ready");
  };

  const confirmPending = async () => {
    if (!pending) return alert("Nothing to save yet.");
    const rec = {
      serial: pending.serial,
      stage: "received",
      operator,
      wagon1Id,
      wagon2Id,
      wagon3Id,
      timestamp: new Date().toISOString(),
      grade: qrExtras.grade,
      railType: qrExtras.railType,
      spec: qrExtras.spec,
      lengthM: qrExtras.lengthM,
      raw: pending.raw,
    };

    setStatus("Saving…");
    try {
      const resp = await fetch(api("/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Save failed");
      setPending(null);
      setWagon1Id(""); setWagon2Id(""); setWagon3Id("");
      setStatus("Ready");
    } catch (e) {
      alert(e.message || "Failed to save");
      setStatus("Ready");
    }
  };

  const handleRemoveScan = (id) => setRemovePrompt(id);
  const confirmRemoveScan = async () => {
    if (!removePrompt) return;
    try {
      const resp = await fetch(api(`/api/staged/${removePrompt}`), { method: "DELETE" });
      if (!resp.ok) throw new Error("Failed to remove scan");
      setScans((prev) => prev.filter((s) => s.id !== removePrompt));
      setRemovePrompt(null);
    } catch (e) {
      alert(e.message || "Failed to remove scan");
      setRemovePrompt(null);
    }
  };
  const discardRemovePrompt = () => setRemovePrompt(null);

  const exportToExcel = async () => {
    setStatus("Exporting…");
    try {
      const resp = await fetch(api("/export-to-excel"), { method: "POST" });
      if (!resp.ok) throw new Error(await resp.text() || "Export failed");
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `Master_${Date.now()}.xlsm`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message);
    } finally {
      setStatus("Ready");
    }
  };

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      {removePrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", zIndex: 50 }}>
          <div className="card" style={{ padding: 20 }}>
            <h3>Confirm Removal</h3>
            <p>Are you sure you want to remove this staged scan?</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-outline" onClick={discardRemovePrompt}>Cancel</button>
              <button className="btn" onClick={confirmRemoveScan}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <button className="btn btn-outline" onClick={() => setView("home")}>Home</button>
            <span className="brand" onClick={() => setView("home")}>Rail Inventory</span>
          </div>
          <div>Status: {status}</div>
        </div>
      </header>

      {view === "home" ? (
        <StartPage onStartScan={() => setView("scan")} onExport={exportToExcel} operator={operator} setOperator={setOperator} />
      ) : (
        <div className="grid" style={{ marginTop: 20 }}>
          <section className="card">
            <h3>Scanner</h3>
            <Scanner onDetected={onDetected} />
            {pending && <div className="notice"><strong>Pending:</strong> {pending.serial}</div>}
          </section>

          <section className="card">
            <h3>Controls</h3>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label>Operator</label>
                <input className="input" value={operator} onChange={e => setOperator(e.target.value)} />
              </div>
              <div>
                <label>Wagon 1 ID</label>
                <input className="input" value={wagon1Id} onChange={e => setWagon1Id(e.target.value)} />
              </div>
              <div>
                <label>Wagon 2 ID</label>
                <input className="input" value={wagon2Id} onChange={e => setWagon2Id(e.target.value)} />
              </div>
              <div>
                <label>Wagon 3 ID</label>
                <input className="input" value={wagon3Id} onChange={e => setWagon3Id(e.target.value)} />
              </div>
              <div>
                <label>Grade</label>
                <input className="input" value={qrExtras.grade} readOnly />
              </div>
              <div>
                <label>Rail Type</label>
                <input className="input" value={qrExtras.railType} readOnly />
              </div>
              <div>
                <label>Spec</label>
                <input className="input" value={qrExtras.spec} readOnly />
              </div>
              <div>
                <label>Length (m)</label>
                <input className="input" value={qrExtras.lengthM} readOnly />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={discardPending} disabled={!pending}>Discard Pending</button>
                <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
                <button className="btn" onClick={exportToExcel}>Export Excel (.xlsm)</button>
              </div>
            </div>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>Staged Scans</h3>
            <div className="list">
              {scans.length === 0 && <div style={{ color: "var(--muted)" }}>No scans yet.</div>}
              {scans.map((s) => (
                <div key={s.id} className="item">
                  <div><strong>{s.serial}</strong> ({s.operator})</div>
                  <div>W1: {s.wagon1Id || "-"} | W2: {s.wagon2Id || "-"} | W3: {s.wagon3Id || "-"}</div>
                  <div>{s.grade} • {s.railType} • {s.spec} • {s.lengthM}m</div>
                  <div>{s.stage} • {new Date(s.timestamp).toLocaleString()}</div>
                  <button className="btn btn-outline" onClick={() => handleRemoveScan(s.id)}>Delete</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
