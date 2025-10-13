// src/app.jsx
import React, { useEffect, useState, useRef } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import { io } from 'socket.io-client';
import './app.css';

// ---- API helper ----
const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => (p.startsWith('/') ? `${API_BASE}${p}` : `/api${p}`);

// ---- QR parsing ----
function parseQrPayload(raw) {
  const clean = String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = clean.split(/[ ,;|:/\t\r\n]+/).filter(Boolean);

  let grade = '';
  let railType = '';
  let serial = '';
  let spec = '';
  let lengthM = '';

  const lenTok = tokens.find(t => /^[0-9]{1,3}m$/i.test(t));
  if (lenTok) lengthM = lenTok.replace(/m/i, '');

  const gTok = tokens.find(t => /^SAR\d{2}$/i.test(t));
  if (gTok) grade = gTok.toUpperCase();

  const tTok = tokens.find(t => /^R\d{3}[A-Z]*$/i.test(t));
  if (tTok) railType = tTok.toUpperCase();

  const sTok = tokens.find(t => /^[A-Z0-9-]{10,22}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t));
  if (sTok) serial = sTok.toUpperCase();

  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`.trim();
    if (/^[A-Z]{2,4}\s+[0-9A-Z/.\-]{3,}$/.test(pair)) { 
      spec = pair.toUpperCase(); 
      break;
    }
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
  const [status, setStatus] = useState('Ready');
  const [scans, setScans] = useState([]);

  // Operator + 3 wagon IDs
  const [operator, setOperator] = useState('Clerk A');
  const [wagon1, setWagon1] = useState('');
  const [wagon2, setWagon2] = useState('');
  const [wagon3, setWagon3] = useState('');

  // Pending scan
  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade:'', railType:'', spec:'', lengthM:'' });

  // Remove confirmation
  const [removePrompt, setRemovePrompt] = useState(null);

  // Beep sound
  const beepRef = useRef(null);
  const ensureBeep = () => {
    if (!beepRef.current) {
      beepRef.current = new Audio(
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA='
      );
    }
    try { beepRef.current.currentTime = 0; beepRef.current.play(); } catch {}
  };

  // Socket.IO
  const socketRef = useRef(null);
  useEffect(() => {
    const fetchScans = async () => {
      try {
        const r = await fetch(api('/staged'));
        if (r.ok) setScans(await r.json());
      } catch {}
    };
    fetchScans();

    const socket = io(API_BASE || 'http://localhost:4000');
    socketRef.current = socket;

    socket.on('new-scan', scan => setScans(prev => [scan, ...prev]));
    socket.on('deleted-scan', ({ id }) => setScans(prev => prev.filter(s => s.id !== id)));
    socket.on('cleared-scans', () => setScans([]));

    return () => socket.disconnect();
  }, []);

  const onDetected = (rawText) => {
    const parsed = parseQrPayload(rawText);
    ensureBeep();
    setPending({
      serial: parsed.serial || rawText,
      raw: parsed.raw,
      capturedAt: new Date().toISOString()
    });
    setQrExtras({
      grade: parsed.grade || '',
      railType: parsed.railType || '',
      spec: parsed.spec || '',
      lengthM: parsed.lengthM || ''
    });
    setStatus('Captured — review & Confirm');
  };

  const discardPending = () => {
    setPending(null);
    setQrExtras({ grade:'', railType:'', spec:'', lengthM:'' });
    setWagon1(''); setWagon2(''); setWagon3('');
    setStatus('Ready');
  };

  const confirmPending = async () => {
    if (!pending) return alert('Nothing to save yet.');
    const rec = {
      serial: pending.serial,
      stage: 'received',
      operator,
      wagon1,
      wagon2,
      wagon3,
      timestamp: new Date().toISOString(),
      ...qrExtras,
      raw: pending.raw
    };
    setStatus('Saving…');
    try {
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(rec)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Save failed');
      setScans(prev => [{ id: data.id || Date.now(), ...rec }, ...prev]);
      discardPending();
    } catch(e) {
      alert(e.message || 'Failed to save');
      setStatus('Ready');
    }
  };

  const deleteScan = async (id) => {
    if (!window.confirm('Remove this scan?')) return;
    try {
      const resp = await fetch(api(`/staged/${id}`), { method: 'DELETE' });
      if (!resp.ok) throw new Error(await resp.text());
      setScans(prev => prev.filter(s => s.id !== id));
    } catch(e) { alert(e.message || 'Failed'); }
  };

  const exportToExcel = async () => {
    setStatus('Exporting…');
    try {
      const resp = await fetch(api('/export-to-excel'), { method:'POST' });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Master_${Date.now()}.xlsm`;
      a.click();
    } catch(e) { alert(e.message); }
    finally { setStatus('Ready'); }
  };

  return (
    <div className="container" style={{ paddingTop:20, paddingBottom:20 }}>
      <header className="app-header">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-outline" onClick={()=>setView('home')}>Home</button>
            <span className="brand" onClick={()=>setView('home')} style={{ cursor:'pointer' }}>Rail Inventory</span>
            <span className="badge">{view==='home'?'Home':'Scan'}</span>
          </div>
          <div>Status: {status}</div>
        </div>
      </header>

      {view==='home' ? (
        <StartPage onStartScan={()=>setView('scan')} onExport={exportToExcel} operator={operator} setOperator={setOperator}/>
      ) : (
        <>
          <section className="card">
            <h3>Scanner</h3>
            <Scanner onDetected={onDetected} />
            {pending && <div className="notice"><strong>Pending:</strong> {pending.serial}</div>}
          </section>

          <section className="card">
            <h3>Controls</h3>
            <input placeholder="Operator" value={operator} onChange={e=>setOperator(e.target.value)}/>
            <input placeholder="Wagon 1 ID" value={wagon1} onChange={e=>setWagon1(e.target.value)}/>
            <input placeholder="Wagon 2 ID" value={wagon2} onChange={e=>setWagon2(e.target.value)}/>
            <input placeholder="Wagon 3 ID" value={wagon3} onChange={e=>setWagon3(e.target.value)}/>
            <input placeholder="Grade" value={qrExtras.grade} readOnly/>
            <input placeholder="Rail Type" value={qrExtras.railType} readOnly/>
            <input placeholder="Spec" value={qrExtras.spec} readOnly/>
            <input placeholder="Length (m)" value={qrExtras.lengthM} readOnly/>

            <button onClick={discardPending} disabled={!pending}>Discard Pending</button>
            <button onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
            <button onClick={exportToExcel}>Export Excel (.xlsm)</button>
          </section>

          <section className="card">
            <h3>Staged Scans</h3>
            {scans.length===0 ? <div>No scans yet</div> :
              scans.map(s=>(
                <div key={s.id} className="item">
                  <div><strong>{s.serial}</strong> ({s.operator})</div>
                  <div>W1: {s.wagon1||'-'} | W2: {s.wagon2||'-'} | W3: {s.wagon3||'-'}</div>
                  <div>{s.grade} • {s.railType} • {s.spec} • {s.lengthM}m</div>
                  <div>{s.stage} • {new Date(s.timestamp).toLocaleString()}</div>
                  <button onClick={()=>deleteScan(s.id)}>Delete</button>
                </div>
              ))
            }
          </section>
        </>
      )}
    </div>
  );
}
