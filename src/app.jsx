// src/App.jsx
import React, { useEffect, useState, useRef } from "react";
import Scanner from "./scanner/Scanner.jsx";
import StartPage from "./StartPage.jsx";
import { io } from "socket.io-client";
import "./app.css";

// ---- API helper ----
const API_BASE = import.meta.env.VITE_API_BASE || "";
const api = (p) => (p.startsWith("/") ? `${API_BASE}${p}` : `${API_BASE}/${p}`);

// ---- QR parsing helper (unchanged) ----
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
      (t) => /^AT[A-Z0-9\-/.]{2,}$/.test(t) || /^[A-Z]{2,4}[A-Z0-9/.\-]{3,}$/.test(t)
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

  // operator + wagon IDs (editable)
  const [operator, setOperator] = useState("Clerk A");
  const [wagon1Id, setWagon1Id] = useState("");
  const [wagon2Id, setWagon2Id] = useState("");
  const [wagon3Id, setWagon3Id] = useState("");

  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: "", railType: "", spec: "", lengthM: "" });

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

  // --- Socket.IO setup ---
  const socketRef = useRef(null);
  useEffect(() => {
    const socket = io(API_BASE || "http://localhost:4000");
    socketRef.current = socket;

    socket.on("new-scan", (scan) => {
      setScans((prev) => [scan, ...prev]);
    });

    socket.on("deleted-scan", ({ id }) => {
      setScans((prev) => prev.filter((s) => s.id !== id));
    });

    socket.on("cleared-scans", () => setScans([]));

    return () => socket.disconnect();
  }, []);

  // Load initial staged scans
  useEffect(() => {
    fetchScans();
  }, []);

  const fetchScans = async () => {
    try {
      const r = await fetch(api("/api/staged"));
      const data = await r.json();
      setScans(data);
    } catch (e) {
      console.warn("Failed to fetch scans:", e);
    }
  };

  const onDetected = (rawText) => {
    const parsed = parseQrPayload(rawText);
    ensureBeep();
    setPending({
      serial: parsed.serial || rawText,
      raw: parsed.raw,
      capturedAt: new Date().toISOString(),
    });
    setQrExtras({
      grade: parsed.grade || "",
      railType: parsed.railType || "",
      spec: parsed.spec || "",
      lengthM: parsed.lengthM || "",
    });
    setStatus("Captured — review & Confirm");
  };

  const confirmPending = async () => {
    if (!pending?.serial) {
      alert("Nothing to save yet. Scan a code first.");
      return;
    }

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
    };

    try {
      const resp = await fetch(api("/api/scan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rec),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Save failed");

      setPending(null);
      setStatus("Ready");
      setWagon1Id("");
      setWagon2Id("");
      setWagon3Id("");
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to save");
      setStatus("Ready");
    }
  };

  const discardPending = () => {
    setPending(null);
    setQrExtras({ grade: "", railType: "", spec: "", lengthM: "" });
    setStatus("Ready");
  };

  const deleteScan = async (id) => {
    if (!window.confirm("Are you sure you want to remove the staged scan from the list?")) return;
    const resp = await fetch(api(`/api/staged/${id}`), { method: "DELETE" });
    const data = await resp.json();
    if (!resp.ok) alert(data.error || "Failed to remove scan");
  };

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setView("home")}>Home</button>
            <span className="brand" style={{ cursor: "pointer" }} onClick={() => setView("home")}>Rail Inventory</span>
          </div>
          <div className="status">Status: {status}</div>
        </div>
      </header>

      {view === "home" ? (
        <StartPage onStartScan={() => setView("scan")} />
      ) : (
        <div className="grid" style={{ marginTop: 20 }}>
          <section className="card">
            <h3>Scanner</h3>
            <Scanner onDetected={onDetected} />
            {pending && <div className="notice" style={{ marginTop: 10 }}><strong>Pending:</strong> {pending.serial}</div>}
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
              {/* Parsed QR preview */}
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
              </div>
            </div>
          </section>

          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>Staged Scans</h3>
            <div className="list">
              {scans.length === 0 && <div style={{ color: "var(--muted)" }}>No scans yet.</div>}
              {scans.map(s => (
                <div key={s.id} className="item">
                  <div><strong>{s.serial}</strong> ({s.operator})</div>
                  <div>W1: {s.wagon1Id || "-"} | W2: {s.wagon2Id || "-"} | W3: {s.wagon3Id || "-"}</div>
                  <div>{s.grade} • {s.railType} • {s.spec} • {s.lengthM}m</div>
                  <div>{s.stage} • {new Date(s.timestamp).toLocaleString()}</div>
                  <button className="btn btn-outline" onClick={() => deleteScan(s.id)}>Delete</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
