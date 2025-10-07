import React, { useState, useEffect } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';

// With Vite proxy: leave API_BASE empty so we call /api/* locally
const API_BASE = import.meta.env.VITE_API_BASE || ''; 
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  // If VITE_API_BASE is set (e.g. https://api.yourdomain.com), use it. Otherwise fallback to /api for dev.
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
};

/* ---------- QR parsing ----------
   We try to pull useful bits commonly seen on your labels:
   - grade:  SAR48 / SAR51
   - railType: R260 / R350HT / R350LHT ...
   - serial: long alphanumeric (e.g., A25060801805CD)
   - spec:   "ATX 200/25C", "ATA 2DX059-25", etc.
   - lengthM: 36m, 24m => "36", "24"
*/
const res = await fetch('/api/scan');


function parseQrPayload(raw) {
  const clean = String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = clean.split(/[ ,;|:/\t\r\n]+/).filter(Boolean);

  let grade   = '';
  let railType= '';
  let serial  = '';
  let spec    = '';
  let lengthM = '';

  // length
  const lenTok = tokens.find(t => /^[0-9]{1,3}m$/i.test(t));
  if (lenTok) lengthM = lenTok.replace(/m/i, '');

  // grade
  const gTok = tokens.find(t => /^SAR\d{2}$/i.test(t));
  if (gTok) grade = gTok.toUpperCase();

  // rail type
  const tTok = tokens.find(t => /^R\d{3}[A-Z]*$/i.test(t));
  if (tTok) railType = tTok.toUpperCase();

  // serial: 10–22 alnum with letters + digits
  const sTok = tokens.find(t => /^[A-Z0-9-]{10,22}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t));
  if (sTok) serial = sTok.toUpperCase();

  // spec: pair or single that looks like ATX/ATA + detail
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`.trim();
    if (/^[A-Z]{2,4}\s+[0-9A-Z/.\-]{3,}$/.test(pair)) { spec = pair.toUpperCase(); break; }
  }
  if (!spec) {
    const one = tokens.find(t => /^AT[A-Z0-9\-/.]{2,}$/.test(t) || /^[A-Z]{2,4}[A-Z0-9/.\-]{3,}$/.test(t));
    if (one) spec = one.toUpperCase();
  }

  if (!serial) {
    const cand = tokens
      .filter(x => /^[A-Z0-9-]{8,32}$/i.test(x))
      .sort((a, b) => b.length - a.length)[0];
    if (cand) serial = cand.toUpperCase();
  }

  return { grade, railType, serial, spec, lengthM, raw: clean };
}

export default function App() {
  const [view, setView] = useState('home'); // 'home' | 'scan'
  const [scans, setScans] = useState([]);
  const [status, setStatus] = useState('Ready');

  // operator + load/wagons
  const [operator, setOperator] = useState('Clerk A');
  const [loadId, setLoadId] = useState('');
  const [wagon1, setWagon1] = useState('');
  const [wagon2, setWagon2] = useState('');
  const [wagon3, setWagon3] = useState('');

  // load staged from backend DB
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(api('/staged'));
        if (r.ok) setScans(await r.json());
      } catch (e) {
        console.warn('Backend not reachable:', e?.message);
      }
    })();
  }, []);

  const onDetected = async (rawText) => {
    // debounce repeat reads within 1.5s
    if (App._last === rawText && Date.now() - (App._lastAt || 0) < 1500) return;
    App._last = rawText; App._lastAt = Date.now();

    // Parse for display (even though backend stores core fields only)
    const parsed = parseQrPayload(rawText);

    const rec = {
      // Backend expects/stores these:
      serial: parsed.serial || rawText, // always send something
      stage: 'received',
      operator,
      loadId, wagon1, wagon2, wagon3,
      timestamp: new Date().toISOString(),
      // We also send the parsed extras for possible future use:
      grade: parsed.grade,
      railType: parsed.railType,
      spec: parsed.spec,
      lengthM: parsed.lengthM,
      raw: parsed.raw,
    };

    setStatus('Saving scan…');
    try {
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Save failed');

      // The SQLite backend returns full rows from /staged; to reflect immediately,
      // append our local rec (serial/operator/time + local extras for UI).
      setScans(prev => [
        {
          id: data.id || Date.now(),
          serial: rec.serial,
          stage: rec.stage,
          operator: rec.operator,
          loadId: rec.loadId,
          wagon1: rec.wagon1,
          wagon2: rec.wagon2,
          wagon3: rec.wagon3,
          timestamp: rec.timestamp,
          // keep parsed extras for UI (not persisted by current backend)
          grade: rec.grade,
          railType: rec.railType,
          spec: rec.spec,
          lengthM: rec.lengthM,
        },
        ...prev
      ]);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to save scan');
    } finally {
      setStatus('Ready');
    }
  };

  const exportToExcel = async () => {
    setStatus('Exporting…');
    try {
      const resp = await fetch(api('/export-to-excel'), { method: 'POST' });
      if (!resp.ok) throw new Error(await resp.text() || 'Export failed');
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = `Master_${Date.now()}.xlsm`; a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message);
    } finally {
      setStatus('Ready');
    }
  };

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className="brand"
              onClick={() => setView('home')}
              style={{ cursor: 'pointer' }}
            >
              Rail Inventory
            </span>
            <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {view === 'home' ? 'Home' : 'Scan'}
            </span>
          </div>
          <div className="status">Status: {status}</div>
        </div>
      </header>

      {view === 'home' ? (
        <StartPage
          onStartScan={() => setView('scan')}
          onExport={exportToExcel}
          operator={operator}
          setOperator={setOperator}
        />
      ) : (
        <>
          <div className="grid" style={{ marginTop: 20 }}>
            <section className="card">
              <h3>Scanner</h3>
              <Scanner onDetected={onDetected} />
            </section>

            <section className="card">
              <h3>Controls</h3>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="status">Load ID</label>
                  <input className="input" value={loadId} onChange={e => setLoadId(e.target.value)} placeholder="e.g. L-2025-09-001" />
                </div>
                <div>
                  <label className="status">Operator</label>
                  <input className="input" value={operator} onChange={e => setOperator(e.target.value)} />
                </div>
                <div>
                  <label className="status">Wagon 1 (Serial)</label>
                  <input className="input" value={wagon1} onChange={e => setWagon1(e.target.value)} placeholder="e.g. NPS-00123" />
                </div>
                <div>
                  <label className="status">Wagon 2 (Serial)</label>
                  <input className="input" value={wagon2} onChange={e => setWagon2(e.target.value)} placeholder="e.g. NPS-00456" />
                </div>
                <div>
                  <label className="status">Wagon 3 (Serial)</label>
                  <input className="input" value={wagon3} onChange={e => setWagon3(e.target.value)} placeholder="e.g. NPS-00789" />
                </div>
                <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn btn-outline" onClick={() => setView('home')}>Back</button>
                  <button className="btn" onClick={exportToExcel}>Export Excel (.xlsm)</button>
                </div>
              </div>
            </section>

            <section className="card" style={{ gridColumn: '1 / -1' }}>
              <h3>Staged Scans</h3>
              <div className="list">
                {scans.length === 0 && <div className="item" style={{ color: 'var(--muted)' }}>No scans yet.</div>}
                {scans.map((s, i) => (
                  <div className="item" key={s.id || i}>
                    <div className="serial">{s.serial || '-'}</div>
                    <div className="meta">
                      {/* These are shown if present (frontend parsed). The current DB doesn’t store them yet. */}
                      { (s.grade || s.railType || s.spec || s.lengthM) ? (
                        <>Grade: {s.grade || '-'} • Type: {s.railType || '-'} • Spec: {s.spec || '-'} • Len: {s.lengthM || '-'}m</>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>No extra QR fields detected</span>
                      )}
                    </div>
                    <div className="meta">
                      {s.stage} • {s.operator} • {new Date(s.timestamp || Date.now()).toLocaleString()}
                    </div>
                    {(s.loadId || s.wagon1 || s.wagon2 || s.wagon3) && (
                      <div className="meta">Load: {s.loadId || '-'} | W1: {s.wagon1 || '-'} | W2: {s.wagon2 || '-'} | W3: {s.wagon3 || '-'}</div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} Premium Star Graphics</span>
          <span className="tag">Rail Inventory • v1.3</span>
        </div>
      </footer>
    </div>
  );
}
