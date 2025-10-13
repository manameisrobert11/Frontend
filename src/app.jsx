// src/App.jsx
import React, { useState, useRef, useEffect } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';

// API helper
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const api = (p) => (p.startsWith('/') ? `${API_BASE}${p}` : `${API_BASE}/${p}`);

// Simple QR parser
function parseQrPayload(raw) {
  const clean = String(raw || '').replace(/[^\x20-\x7E]/g, ' ').trim();
  const serial = clean.split(/\s+/)[0] || raw;
  return { serial, raw: clean };
}

export default function App() {
  const [view, setView] = useState('home');
  const [status, setStatus] = useState('Ready');
  const [scans, setScans] = useState([]);

  // Operator + 3 Wagon IDs
  const [operator, setOperator] = useState('Clerk A');
  const [wagon1, setWagon1] = useState('');
  const [wagon2, setWagon2] = useState('');
  const [wagon3, setWagon3] = useState('');

  // Pending scan
  const [pending, setPending] = useState(null);

  // Beep
  const beepRef = useRef(null);
  const ensureBeep = () => {
    if (!beepRef.current) {
      const dataUri =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=';
      beepRef.current = new Audio(dataUri);
    }
    try { beepRef.current.currentTime = 0; beepRef.current.play(); } catch {}
  };

  // Load staged scans
  useEffect(() => {
    fetch(api('/staged'))
      .then((r) => r.ok && r.json())
      .then(setScans)
      .catch(() => console.warn('Backend not reachable'));
  }, []);

  // Scanner callback
  const onDetected = (rawText) => {
    ensureBeep();
    const parsed = parseQrPayload(rawText);
    setPending({
      serial: parsed.serial,
      raw: parsed.raw,
      timestamp: new Date().toISOString(),
    });
    setStatus('Captured — review & confirm');
  };

  // Confirm pending scan
  const confirmPending = async () => {
    if (!pending) return alert('Nothing to save yet.');
    setStatus('Saving…');
    try {
      const rec = {
        serial: pending.serial,
        stage: 'received',
        operator,
        wagon1,
        wagon2,
        wagon3,
        timestamp: new Date().toISOString(),
      };
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Save failed');
      setScans([rec, ...scans]);
      setPending(null);
      setStatus('Ready');
    } catch (e) {
      alert(e.message);
      setStatus('Ready');
    }
  };

  // Discard pending scan
  const discardPending = () => {
    setPending(null);
    setStatus('Ready');
  };

  // Export to Excel
  const exportToExcel = async () => {
    setStatus('Exporting…');
    try {
      const resp = await fetch(api('/export-to-excel'), { method: 'POST' });
      if (!resp.ok) throw new Error(await resp.text() || 'Export failed');
      const blob = await resp.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `Master_${Date.now()}.xlsm`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      alert(e.message);
    } finally {
      setStatus('Ready');
    }
  };

  return (
    <div className="container" style={{ padding: 20 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2>Rail Inventory</h2>
        <span>Status: {status}</span>
      </header>

      {view === 'home' ? (
        <StartPage onStartScan={() => setView('scan')} onExport={exportToExcel} operator={operator} setOperator={setOperator} />
      ) : (
        <>
          <section style={{ marginBottom: 20 }}>
            <h3>Scanner</h3>
            <Scanner onDetected={onDetected} />
            {pending && <div><strong>Pending:</strong> {pending.serial}</div>}
          </section>

          <section style={{ marginBottom: 20 }}>
            <h3>Controls</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input placeholder="Operator" value={operator} onChange={e => setOperator(e.target.value)} />
              <input placeholder="Wagon 1" value={wagon1} onChange={e => setWagon1(e.target.value)} />
              <input placeholder="Wagon 2" value={wagon2} onChange={e => setWagon2(e.target.value)} />
              <input placeholder="Wagon 3" value={wagon3} onChange={e => setWagon3(e.target.value)} />
              <button onClick={discardPending} disabled={!pending}>Discard Pending</button>
              <button onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
              <button onClick={exportToExcel}>Export Excel</button>
            </div>
          </section>

          <section>
            <h3>Staged Scans</h3>
            {scans.length === 0 ? <p>No scans yet.</p> : scans.map((s, i) => (
              <div key={i} style={{ borderBottom: '1px solid #ccc', padding: 5 }}>
                <div><strong>{s.serial}</strong></div>
                <div>Operator: {s.operator}</div>
                <div>W1: {s.wagon1} | W2: {s.wagon2} | W3: {s.wagon3}</div>
                <div>Timestamp: {new Date(s.timestamp).toLocaleString()}</div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
