import React, { useEffect, useState } from 'react';
import Scanner from './scanner/Scanner.jsx';
import './app.css';

// IMPORTANT: keep API_BASE empty so calls go through Netlify proxy (/api/* → Render)
const API_BASE = '';

function normalizeScanText(t) {
  if (!t) return '';
  const clean = String(t).replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
  const token = clean
    .split(/[ ,;|:/\t\r\n]+/)
    .filter(x => /^[A-Za-z0-9-]{8,64}$/.test(x))
    .sort((a,b) => b.length - a.length)[0] || clean;
  return token.replace(/\s+/g, '').toUpperCase();
}

export default function App() {
  const [status, setStatus] = useState('Ready');
  const [scans, setScans]   = useState([]);
  const [operator, setOperator] = useState('Clerk A');

  // batch/wagons
  const [loadId, setLoadId] = useState('');
  const [wagon1, setWagon1] = useState('');
  const [wagon2, setWagon2] = useState('');
  const [wagon3, setWagon3] = useState('');

  // load staged scans on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/health`);
        if (!r.ok) throw new Error('Backend not reachable');
      } catch (e) {
        console.warn('Health check failed:', e.message);
      }

      try {
        const r = await fetch(`/api/staged`);
        if (r.ok) setScans(await r.json());
      } catch {
        // ignore for now
      }
    })();
  }, []);

  const onDetected = async (rawText) => {
    // debounce same payload within 1.5s
    if (App._last === rawText && Date.now() - (App._lastAt || 0) < 1500) return;
    App._last = rawText; App._lastAt = Date.now();

    const serial = normalizeScanText(rawText);
    const rec = {
      serial, stage: 'received', operator,
      loadId, wagon1, wagon2, wagon3,
      timestamp: new Date().toISOString()
    };

    setStatus('Saving scan…');
    try {
      const resp = await fetch(`/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(rec)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Save failed');
      setScans(prev => [...prev, data.record]);
    } catch (e) {
      alert(e.message || 'Failed to save scan');
    } finally {
      setStatus('Ready');
    }
  };

  const exportToExcel = async () => {
    setStatus('Exporting…');
    try {
      const resp = await fetch(`/api/export-to-excel`, { method: 'POST' });
      if (!resp.ok) throw new Error(await resp.text() || 'Export failed');

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Master_${Date.now()}.xlsm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    } finally {
      setStatus('Ready');
    }
  };

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div className="container" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span className="brand">Rail Inventory</span>
            <span className="badge badge-blue">Scan</span>
          </div>
          <div className="status">Status: {status}</div>
        </div>
      </header>

      <div className="grid" style={{ marginTop: 20 }}>
        <section className="card">
          <h3>Scanner</h3>
          <Scanner onDetected={onDetected} />
        </section>

        <section className="card">
          <h3>Controls</h3>
          <div className="grid" style={{gridTemplateColumns:'1fr 1fr', gap: 12}}>
            <div>
              <label className="label">Load ID</label>
              <input className="input" value={loadId} onChange={e=>setLoadId(e.target.value)} placeholder="e.g. L-2025-09-001" />
            </div>
            <div>
              <label className="label">Operator</label>
              <input className="input" value={operator} onChange={e=>setOperator(e.target.value)} />
            </div>
            <div>
              <label className="label">Wagon 1 (Serial)</label>
              <input className="input" value={wagon1} onChange={e=>setWagon1(e.target.value)} placeholder="e.g. NPS-00123" />
            </div>
            <div>
              <label className="label">Wagon 2 (Serial)</label>
              <input className="input" value={wagon2} onChange={e=>setWagon2(e.target.value)} placeholder="e.g. NPS-00456" />
            </div>
            <div>
              <label className="label">Wagon 3 (Serial)</label>
              <input className="input" value={wagon3} onChange={e=>setWagon3(e.target.value)} placeholder="e.g. NPS-00789" />
            </div>
            <div style={{display:'flex',alignItems:'end',justifyContent:'flex-end'}}>
              <button className="btn btn-primary" onClick={exportToExcel}>Export to Excel (.xlsm)</button>
            </div>
          </div>
        </section>

        <section className="card" style={{gridColumn:'1 / -1'}}>
          <h3>Staged Scans</h3>
          <div className="list">
            {scans.length === 0 && <div className="item" style={{color:'var(--muted)'}}>No scans yet.</div>}
            {scans.map((s,i)=>(
              <div className="item" key={i}>
                <div className="serial">{s.serial}</div>
                <div className="meta">
                  {s.stage} • {s.operator} • {new Date(s.timestamp).toLocaleString()}
                  {(s.loadId || s.wagon1 || s.wagon2 || s.wagon3) && (
                    <div>Load: {s.loadId || '-'} | W1: {s.wagon1 || '-'} | W2: {s.wagon2 || '-'} | W3: {s.wagon3 || '-'}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} Premium Star Graphics</span>
          <span className="tag">Rail Inventory • v1.0</span>
        </div>
      </footer>
    </div>
  );
}
