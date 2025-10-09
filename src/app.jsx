// src/app.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';

// ---- API helper (kept as you have it) ----
const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
};

// ---- QR parsing (same as before) ----
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
  const [view, setView] = useState('home');         // 'home' | 'scan'
  const [status, setStatus] = useState('Ready');
  const [scans, setScans] = useState([]);

  // operator + wagon ID (single, assigned per scan)
  const [operator, setOperator] = useState('Clerk A');
  const [wagonId, setWagonId]   = useState('');

  // pending capture (review before saving)
  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade:'', railType:'', spec:'', lengthM:'' });

  // Duplicate prompt
  const [dupPrompt, setDupPrompt] = useState(null);

  // Beeps
  const beepRef = useRef(null);
  const ensureBeep = (hz = 1500, ms = 120) => {
    if (!beepRef.current) {
      const dataUri =
        'data:audio/wav;base64,' +
        'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=';
      beepRef.current = new Audio(dataUri);
    }
    try {
      beepRef.current.playbackRate = Math.max(0.5, Math.min(2, hz / 1500));
      beepRef.current.currentTime = 0;
      beepRef.current.play();
    } catch {}
  };
  const okBeep = () => ensureBeep(1500, 120);
  const warnBeep = () => ensureBeep(800, 160);

  // Load staged list on mount
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

  // fast lookup for duplicates
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

  // Called by Scanner when it reads something
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

  // Confirm save
  const confirmPending = async () => {
    if (!pending?.serial) {
      alert('Nothing to save yet. Scan a code first.');
      return;
    }

    const dupNow = findDuplicates(pending.serial);
    if (dupNow.length > 0 && !window.confirm(`Warning: "${pending.serial}" is already in the staged list (${dupNow.length} match). Continue and save anyway?`)) {
      return;
    }

    const rec = {
      serial: pending.serial,
      stage: 'received',
      operator,
      wagonId, // ← single Wagon ID tied to this scan
      timestamp: new Date().toISOString(),
      grade: qrExtras.grade,
      railType: qrExtras.railType,
      spec: qrExtras.spec,
      lengthM: qrExtras.lengthM,
      raw: pending.raw
    };

    setStatus('Saving…');
    try {
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || 'Save failed');

      setScans(prev => [
        {
          id: data.id || Date.now(),
          serial: rec.serial,
          stage: rec.stage,
          operator: rec.operator,
          wagonId: rec.wagonId,
          timestamp: rec.timestamp,
          grade: rec.grade,
          railType: rec.railType,
          spec: rec.spec,
          lengthM: rec.lengthM,
        },
        ...prev
      ]);

      setPending(null);
      setStatus('Ready');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to save');
      setStatus('Ready');
    }
  };

  const discardPending = () => {
    setPending(null);
    setQrExtras({ grade:'', railType:'', spec:'', lengthM:'' });
    setStatus('Ready');
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
      {/* Duplicate modal */}
      {dupPrompt && (
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" style={{ maxWidth: 520, width: '100%', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(220,38,38,.1)', color: 'rgb(220,38,38)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>QR already scanned</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  <strong>{dupPrompt.serial}</strong> appears in your staged list ({dupPrompt.matches.length} match{dupPrompt.matches.length>1?'es':''}).
                </div>
                <div className="list" style={{ marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                  {dupPrompt.matches.map((m, i) => (
                    <div className="item" key={m.id || i}>
                      <div className="serial">{m.serial}</div>
                      <div className="meta">
                        {m.stage} • {m.operator} • {new Date(m.timestamp || Date.now()).toLocaleString()}
                      </div>
                      {!!m.wagonId && <div className="meta">Wagon: {m.wagonId}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-outline" onClick={handleDupDiscard}>Discard</button>
                  <button className="btn" onClick={handleDupContinue}>Continue</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => setView('home')}>Home</button>
            <span className="brand" style={{ cursor: 'pointer' }} onClick={() => setView('home')}>
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
              {pending && (
                <div className="notice" style={{ marginTop: 10 }}>
                  <strong>Pending capture:</strong> {pending.serial}
                </div>
              )}
              {pending?.serial && scanSerialSet.has(String(pending.serial).trim().toUpperCase()) && (
                <div className="notice" style={{ marginTop: 8, color: 'rgb(220,38,38)' }}>
                  ⚠️ Warning: this QR matches an already staged serial.
                </div>
              )}
            </section>

            <section className="card">
              <h3>Controls</h3>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label className="status">Operator</label>
                  <input className="input" value={operator} onChange={e => setOperator(e.target.value)} />
                </div>
                <div>
                  <label className="status">Wagon ID</label>
                  <input
                    className="input"
                    value={wagonId}
                    onChange={e => setWagonId(e.target.value)}
                    placeholder="e.g. WGN-0123"
                  />
                </div>

                {/* Read-only preview of parsed extras */}
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
                  <label className="status">Length (m)</label>
                  <input className="input" value={qrExtras.lengthM} readOnly />
                </div>

                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setView('home')}>Back</button>
                  <button className="btn btn-outline" onClick={discardPending} disabled={!pending}>Discard Pending</button>
                  <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
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
                      {(s.grade || s.railType || s.spec || s.lengthM) ? (
                        <>Grade: {s.grade || '-'} • Type: {s.railType || '-'} • Spec: {s.spec || '-'} • Len: {s.lengthM || '-'}m</>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>No extra QR fields detected</span>
                      )}
                    </div>
                    <div className="meta">
                      {s.stage} • {s.operator} • {new Date(s.timestamp || Date.now()).toLocaleString()}
                    </div>
                    {!!s.wagonId && <div className="meta">Wagon: {s.wagonId}</div>}
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
          <span className="tag">Rail Inventory • v1.6</span>
        </div>
      </footer>
    </div>
  );
}
