// src/App.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';

// ---- API helper ----
const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
};

// ---- QR parsing ----
function parseQrPayload(raw) {
  const clean = String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = clean.split(/[ ,;|:/\t\r\n]+/).filter(Boolean);

  const serial   = tokens.find(t => /^[A-Z0-9]{8,}$/.test(t));
  const grade    = tokens.find(t => /^SAR\d{2}$/i.test(t)) || '';
  const railType = (tokens.find(t => /^R(260|350(L?HT)?)$/i) || '').toUpperCase();
  const spec     = tokens.find(t => /^(ATX|AREMA|UIC|EN|GB)/i) || '';
  const lengthM  = tokens.find(t => /^\d+(\.\d+)?m$/i) || '';

  return { raw: clean, serial, grade, railType, spec, lengthM };
}

export default function App() {
  const [status, setStatus] = useState('Ready');
  const [scans, setScans] = useState([]);

  // Start page first (classic flow)
  const [showStart, setShowStart] = useState(true);

  // Controls
  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState(''); // plain text
  const [loadedAt, setLoadedAt] = useState('');     // plain text

  // Pending capture + parsed extras
  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade:'', railType:'', spec:'', lengthM:'' });

  // Duplicate & Remove prompts
  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // Beeps
  const beepRef = useRef(null);
  const ensureBeep = (hz = 1500) => {
    if (!beepRef.current) {
      const dataUri = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=';
      beepRef.current = new Audio(dataUri);
    }
    try {
      beepRef.current.playbackRate = Math.max(0.5, Math.min(2, hz / 1500));
      beepRef.current.currentTime = 0;
      beepRef.current.play();
    } catch {}
  };
  const okBeep = () => ensureBeep(1500);
  const warnBeep = () => ensureBeep(800);

  // Load staged on mount (normalize wagonId keys)
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(api('/staged'));
        const data = await resp.json().catch(() => []);
        if (Array.isArray(data)) {
          const normalized = data.map((r) => ({
            ...r,
            wagonId1: r.wagonId1 ?? r.wagon1Id ?? '',
            wagonId2: r.wagonId2 ?? r.wagon2Id ?? '',
            wagonId3: r.wagonId3 ?? r.wagon3Id ?? '',
          }));
          setScans(normalized);
        }
      } catch (e) { console.error(e); }
    })();
  }, []);

  // Duplicate helpers
  const scanSerialSet = useMemo(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(String(r.serial).trim().toUpperCase());
    return s;
  }, [scans]);

  const findDuplicates = (serial) => {
    const key = String(serial || '').trim().toUpperCase();
    if (!key) return [];
    return scans.filter(r => String(r.serial || '').trim().toUpperCase() === key);
  };

  // Scanner callback
  const onDetected = (rawText) => {
    const parsed = parseQrPayload(rawText);
    const serial = parsed.serial || rawText;

    if (serial) {
      const matches = findDuplicates(serial);
      if (matches.length > 0) {
        warnBeep();
        setDupPrompt({
          serial: String(serial).toUpperCase(),
          matches,
          candidate: {
            pending: {
              serial: String(serial).toUpperCase(),
              raw: parsed.raw || String(rawText),
              capturedAt: new Date().toISOString(),
            },
            qrExtras: {
              grade: parsed.grade || '',
              railType: parsed.railType || '',
              spec: parsed.spec || '',
              lengthM: parsed.lengthM || '',
            }
          }
        });
        setStatus('Duplicate detected — awaiting decision');
        return;
      }
    }

    okBeep();
    setPending({
      serial: (parsed.serial || rawText),
      raw: parsed.raw || String(rawText),
      capturedAt: new Date().toISOString(),
    });
    setQrExtras({
      grade: parsed.grade || '',
      railType: parsed.railType || '',
      spec: parsed.spec || '',
      lengthM: parsed.lengthM || '',
    });
    setStatus('Captured — review & Confirm');
  };

  // Duplicate modal actions
  const handleDupDiscard = () => {
    setDupPrompt(null);
    setPending(null);
    setQrExtras({ grade:'', railType:'', spec:'', lengthM:'' });
    setStatus('Ready');
  };
  const handleDupContinue = () => {
    if (!dupPrompt) return;
    okBeep();
    setPending(dupPrompt.candidate.pending);
    setQrExtras(dupPrompt.candidate.qrExtras);
    setDupPrompt(null);
    setStatus('Captured — review & Confirm');
  };

  // Remove staged scan (legacy route)
  const handleRemoveScan = (scanId) => setRemovePrompt(scanId);
  const confirmRemoveScan = async () => {
    if (!removePrompt) return;
    try {
      const resp = await fetch(api(`/staged/${removePrompt}`), { method: 'DELETE' });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(errText || 'Failed to remove scan');
      }
      setScans(prev => prev.filter(scan => scan.id !== removePrompt));
      setRemovePrompt(null);
      setStatus('Scan removed successfully');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to remove scan');
      setRemovePrompt(null);
    }
  };
  const discardRemovePrompt = () => setRemovePrompt(null);

  // Confirm & Save (legacy save route)
  const confirmPending = async () => {
    if (!pending?.serial || !String(pending.serial).trim()) {
      alert('Nothing to save yet. Scan a code first.');
      return;
    }
    const dupNow = findDuplicates(pending.serial);
    if (dupNow.length > 0 &&
        !window.confirm(`Warning: "${pending.serial}" is already in the staged list (${dupNow.length} match). Continue and save anyway?`)) {
      return;
    }

    const rec = {
      serial: String(pending.serial).trim(),
      stage: 'received',
      operator,
      wagonId1,
      wagonId2,
      wagonId3,
      receivedAt,   // plain text
      loadedAt,     // plain text
      timestamp: new Date().toISOString(),
      grade: qrExtras.grade,
      railType: qrExtras.railType,
      spec: qrExtras.spec,
      lengthM: qrExtras.lengthM,
    };

    try {
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });

      let data = null;
      try { data = await resp.json(); } catch {}

      if (!resp.ok) {
        const text = data?.error || data?.message || (await resp.text().catch(() => ''));
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const newId = data?.id || Date.now();
      setScans(prev => [{ id: newId, ...rec }, ...prev]);

      setPending(null);
      setQrExtras({ grade:'', railType:'', spec:'', lengthM:'' });
      setStatus('Saved to staged');
    } catch (e) {
      console.error('Save failed:', e);
      alert(`Save failed: ${e.message}`);
      setStatus('Save failed');
    }
  };

  // Export to Excel (downloads the .xlsm from backend)
  const exportToExcel = async () => {
    try {
      const resp = await fetch(api('/export-to-excel'), { method: 'POST' });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      // derive filename from Content-Disposition header or fallback
      const dispo = resp.headers.get('Content-Disposition') || '';
      const match = dispo.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `Master_${Date.now()}.xlsm`;

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${filename}`);
    } catch (e) {
      console.error('Export failed:', e);
      alert(`Export failed: ${e.message}\n(Ensure uploads/template.xlsm exists on the server)`);
      setStatus('Export failed');
    }
  };

  // ---------- RENDER ----------

  // 1) START PAGE (classic page, blue background, no overlay; Start Scanning triggers onContinue)
  if (showStart) {
    return (
      <div style={{
        minHeight:'100vh',
        background:'#0b5ed7', // blue background as requested
        display:'grid',
        placeItems:'center',
        padding:20
      }}>
        <div style={{ width:'min(980px, 94vw)' }}>
          {/* StartPage should call props.onContinue() when the user clicks "Start Scanning" */}
          <StartPage onContinue={() => setShowStart(false)} />
        </div>
      </div>
    );
  }

  // 2) SCANNING APP
  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="logo" />
            <div>
              <div className="title">Rail Inventory</div>
              <div className="status">{status}</div>
            </div>
          </div>

          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-outline" onClick={() => setShowStart(true)}>Back to Start</button>
            <button className="btn" onClick={exportToExcel}>Export to Excel</button>
          </div>
        </div>
      </header>

      <div className="grid" style={{ marginTop: 20 }}>
        {/* Scanner */}
        <section className="card">
          <h3>Scanner</h3>
          <Scanner onDetected={onDetected} />
          {pending && (
            <div className="notice" style={{ marginTop: 10 }}>
              <div><strong>Pending Serial:</strong> {pending.serial}</div>
              <div className="meta">Captured at: {new Date(pending.capturedAt).toLocaleString()}</div>
            </div>
          )}
        </section>

        {/* Controls */}
        <section className="card">
          <h3>Controls</h3>
          <div className="controls-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label className="status">Operator</label>
              <input className="input" value={operator} onChange={e => setOperator(e.target.value)} />
            </div>

            {/* Three "Wagon ID" fields */}
            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId1} onChange={e => setWagonId1(e.target.value)} placeholder="e.g. WGN-0123" />
            </div>
            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId2} onChange={e => setWagonId2(e.target.value)} placeholder="e.g. WGN-0456" />
            </div>
            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId3} onChange={e => setWagonId3(e.target.value)} placeholder="e.g. WGN-0789" />
            </div>

            {/* Timing fields as plain text */}
            <div>
              <label className="status">Recieved at</label>
              <input
                className="input"
                value={receivedAt}
                onChange={e => setReceivedAt(e.target.value)}
                placeholder=""
              />
            </div>
            <div>
              <label className="status">Loaded at</label>
              <input
                className="input"
                value={loadedAt}
                onChange={e => setLoadedAt(e.target.value)}
                placeholder=""
              />
            </div>

            {/* Read-only parsed extras */}
            <div>
              <label className="status">Grade</label>
              <input className="input" value={qrExtras.grade} readOnly />
            </div>
            <div>
              <label className="status">Rail Type</label>
              <input className="input" value={qrExtras.railType} readOnly />
            </div>
            <div>
              <label className="status">Spec</label>
              <input className="input" value={qrExtras.spec} readOnly />
            </div>
            <div>
              <label className="status">Length</label>
              <input className="input" value={qrExtras.lengthM} readOnly />
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
            <button
              className="btn btn-outline"
              onClick={() => { setPending(null); setQrExtras({ grade:'', railType:'', spec:'', lengthM:'' }); setStatus('Ready'); }}
            >
              Discard
            </button>
          </div>
        </section>

        {/* Staged Scans */}
        <section className="card">
          <h3>Staged Scans</h3>
          <div className="list">
            {scans.map((s) => (
              <div key={s.id} className="row">
                <div className="title">{s.serial}</div>
                <div className="meta">
                  {s.stage} • {s.operator} • {new Date(s.timestamp || Date.now()).toLocaleString()}
                </div>

                {(s.wagonId1 || s.wagonId2 || s.wagonId3) && (
                  <div className="meta">Wagon IDs: {[s.wagonId1, s.wagonId2, s.wagonId3].filter(Boolean).join(' • ')}</div>
                )}

                {(s.receivedAt || s.loadedAt) && (
                  <div className="meta">
                    {s.receivedAt ? `Recieved at: ${s.receivedAt}` : ''}
                    {s.receivedAt && s.loadedAt ? ' • ' : ''}
                    {s.loadedAt ? `Loaded at: ${s.loadedAt}` : ''}
                  </div>
                )}

                <div className="meta">
                  {[s.grade, s.railType, s.spec, s.lengthM].filter(Boolean).join(' • ')}
                </div>

                <button className="btn btn-outline" onClick={() => handleRemoveScan(s.id)}>Remove</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} Premium Star Graphics</span>
          <span className="tag">Rail Inventory • v1.9</span>
        </div>
      </footer>

      {/* Remove confirmation */}
      {removePrompt && (
        <div role="dialog" aria-modal="true"
          style={{ position:'fixed', inset:0, background:'rgba(2,6,23,.55)', display:'grid', placeItems:'center', zIndex:50, padding:16 }}>
          <div className="card" style={{ maxWidth:520, width:'100%', border:'1px solid var(--border)', boxShadow:'0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ width:40, height:40, borderRadius:9999, display:'grid', placeItems:'center', background:'rgba(220,38,38,.1)', color:'rgb(220,38,38)', fontSize:22 }}>⚠️</div>
              <div style={{ flex:1 }}>
                <h3 style={{ margin:0 }}>Are you sure?</h3>
                <div className="status" style={{ marginTop:6 }}>Are you sure you want to remove this staged scan from the list?</div>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
                  <button className="btn btn-outline" onClick={discardRemovePrompt}>Cancel</button>
                  <button className="btn" onClick={confirmRemoveScan}>Confirm</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate modal */}
      {dupPrompt && (
        <div role="dialog" aria-modal="true"
          style={{ position:'fixed', inset:0, background:'rgba(2,6,23,.55)', display:'grid', placeItems:'center', zIndex:50, padding:16 }}>
          <div className="card" style={{ maxWidth:560, width:'100%', border:'1px solid var(--border)', boxShadow:'0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
              <div style={{ width:40, height:40, borderRadius:9999, display:'grid', placeItems:'center', background:'rgba(251,191,36,.15)', color:'rgb(202,138,4)', fontSize:22 }}>⚠️</div>
              <div style={{ flex:1 }}>
                <h3 style={{ margin:0 }}>Duplicate detected</h3>
                <div className="status" style={{ marginTop:6 }}>
                  The serial <strong>{dupPrompt.serial}</strong> already exists in the staged list ({dupPrompt.matches.length}).
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
                  <button className="btn btn-outline" onClick={handleDupDiscard}>Discard</button>
                  <button className="btn" onClick={handleDupContinue}>Continue anyway</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
