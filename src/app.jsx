// src/app.jsx
import React, { useEffect, useState, useRef } from 'react';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import { io } from 'socket.io-client';
import './app.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => p.startsWith('/') ? `${API_BASE}${p}` : `/api${p}`;

function parseQrPayload(raw) {
  const clean = String(raw || '').replace(/[^\x20-\x7E]/g,' ').replace(/\s+/g,' ').trim();
  const tokens = clean.split(/[ ,;|:/\t\r\n]+/).filter(Boolean);

  let grade='', railType='', serial='', spec='', lengthM='';
  const lenTok = tokens.find(t => /^[0-9]{1,3}m$/i.test(t));
  if(lenTok) lengthM = lenTok.replace(/m/i,'');
  const gTok = tokens.find(t => /^SAR\d{2}$/i.test(t));
  if(gTok) grade = gTok.toUpperCase();
  const tTok = tokens.find(t => /^R\d{3}[A-Z]*$/i.test(t));
  if(tTok) railType = tTok.toUpperCase();
  const sTok = tokens.find(t => /^[A-Z0-9-]{10,22}$/i.test(t) && /[A-Z]/i.test(t) && /\d/.test(t));
  if(sTok) serial = sTok.toUpperCase();

  for(let i=0;i<tokens.length-1;i++){
    const pair = `${tokens[i]} ${tokens[i+1]}`.trim();
    if(/^[A-Z]{2,4}\s+[0-9A-Z/.\-]{3,}$/.test(pair)){ spec=pair.toUpperCase(); break; }
  }

  if(!spec){
    const one = tokens.find(t => /^AT[A-Z0-9\-/.]{2,}$/.test(t) || /^[A-Z]{2,4}[A-Z0-9/.\-]{3,}$/.test(t));
    if(one) spec=one.toUpperCase();
  }

  if(!serial){
    const cand = tokens.filter(x=> /^[A-Z0-9-]{8,32}$/i.test(x)).sort((a,b)=>b.length-a.length)[0];
    if(cand) serial = cand.toUpperCase();
  }

  return { grade, railType, serial, spec, lengthM, raw: clean };
}

export default function App() {
  const [view,setView] = useState('home');
  const [status,setStatus] = useState('Ready');
  const [scans,setScans] = useState([]);

  const [operator,setOperator] = useState('Clerk A');
  const [wagon1,setWagon1] = useState('');
  const [wagon2,setWagon2] = useState('');
  const [wagon3,setWagon3] = useState('');

  const [pending,setPending] = useState(null);
  const [qrExtras,setQrExtras] = useState({grade:'', railType:'', spec:'', lengthM:''});
  const [removePrompt,setRemovePrompt] = useState(null);

  const beepRef = useRef(null);
  const ensureBeep = () => {
    if(!beepRef.current){
      beepRef.current = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=');
    }
    try{ beepRef.current.currentTime=0; beepRef.current.play(); } catch{}
  };

  // Load staged + Socket.IO live updates
  const socketRef = useRef(null);
  useEffect(()=>{
    (async()=>{
      try{
        const r = await fetch(api('/staged'));
        if(r.ok) setScans(await r.json());
      }catch(e){ console.warn(e?.message); }
    })();

    const socket = io(API_BASE || "http://localhost:4000");
    socketRef.current = socket;
    socket.on("new-scan", scan => setScans(prev=>[scan,...prev]));
    socket.on("deleted-scan", ({id}) => setScans(prev=>prev.filter(s=>s.id!==id)));
    socket.on("cleared-scans", ()=>setScans([]));
    return ()=> socket.disconnect();
  }, []);

  const onDetected = rawText=>{
    const parsed = parseQrPayload(rawText);
    ensureBeep();
    setPending({ serial: parsed.serial || rawText, raw: parsed.raw, capturedAt: new Date().toISOString() });
    setQrExtras({ grade: parsed.grade, railType: parsed.railType, spec: parsed.spec, lengthM: parsed.lengthM });
    setStatus('Captured — review & Confirm');
  };

  const confirmPending = async()=>{
    if(!pending?.serial){ alert('Nothing to save yet.'); return; }

    const rec = {
      serial: pending.serial,
      stage:'received',
      operator,
      wagon1, wagon2, wagon3,
      timestamp: new Date().toISOString(),
      grade: qrExtras.grade,
      railType: qrExtras.railType,
      spec: qrExtras.spec,
      lengthM: qrExtras.lengthM,
      raw: pending.raw
    };

    setStatus('Saving…');
    try{
      const resp = await fetch(api('/scan'), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(rec)
      });
      const data = await resp.json();
      if(!resp.ok) throw new Error(data.error||'Save failed');

      setScans(prev=>[{...rec,id:data.id||Date.now()}, ...prev]);
      setPending(null); setWagon1(''); setWagon2(''); setWagon3('');
      setStatus('Ready');
    }catch(e){ console.error(e); alert(e.message||'Failed to save'); setStatus('Ready'); }
  };

  const discardPending = ()=>{
    setPending(null);
    setQrExtras({grade:'', railType:'', spec:'', lengthM:''});
    setStatus('Ready');
  };

  const deleteScan = async(id)=>{
    if(!window.confirm('Remove staged scan?')) return;
    const resp = await fetch(api(`/staged/${id}`),{method:'DELETE'});
    const data = await resp.json();
    if(!resp.ok) alert(data.error || 'Failed to remove scan');
  };

  const exportToExcel = async()=>{
    setStatus('Exporting…');
    try{
      const resp = await fetch(api('/export-to-excel'),{method:'POST'});
      if(!resp.ok) throw new Error(await resp.text()||'Export failed');
      const blob = await resp.blob();
      const a=document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Master_${Date.now()}.xlsm`;
      a.click();
      URL.revokeObjectURL(a.href);
    }catch(e){ alert(e.message); }
    setStatus('Ready');
  };

  return (
    <div className="container" style={{paddingTop:20,paddingBottom:20}}>
      <header className="app-header">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-outline" onClick={()=>setView('home')}>Home</button>
            <span className="brand" onClick={()=>setView('home')} style={{cursor:'pointer'}}>Rail Inventory</span>
            <span className="badge">{view==='home'?'Home':'Scan'}</span>
          </div>
          <div>Status: {status}</div>
        </div>
      </header>

      {view==='home'?<StartPage onStartScan={()=>setView('scan')} onExport={exportToExcel} operator={operator} setOperator={setOperator}/>:
      <>
        <div className="grid" style={{marginTop:20}}>
          <section className="card">
            <h3>Scanner</h3>
            <Scanner onDetected={onDetected}/>
            {pending && <div><strong>Pending capture:</strong> {pending.serial}</div>}
          </section>

          <section className="card">
            <h3>Controls</h3>
            <div className="grid" style={{gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div>
                <label>Operator</label>
                <input className="input" value={operator} onChange={e=>setOperator(e.target.value)}/>
              </div>
              <div>
                <label>Wagon 1 ID</label>
                <input className="input" value={wagon1} onChange={e=>setWagon1(e.target.value)}/>
              </div>
              <div>
                <label>Wagon 2 ID</label>
                <input className="input" value={wagon2} onChange={e=>setWagon2(e.target.value)}/>
              </div>
              <div>
                <label>Wagon 3 ID</label>
                <input className="input" value={wagon3} onChange={e=>setWagon3(e.target.value)}/>
              </div>
              <div>
                <label>Grade</label>
                <input className="input" value={qrExtras.grade} readOnly/>
              </div>
              <div>
                <label>Rail Type</label>
                <input className="input" value={qrExtras.railType} readOnly/>
              </div>
              <div>
                <label>Spec</label>
                <input className="input" value={qrExtras.spec} readOnly/>
              </div>
              <div>
                <label>Length (m)</label>
                <input className="input" value={qrExtras.lengthM} readOnly/>
              </div>
              <div style={{gridColumn:'1 / -1', display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button className="btn btn-outline" onClick={discardPending} disabled={!pending}>Discard Pending</button>
                <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
                <button className="btn" onClick={exportToExcel}>Export Excel (.xlsm)</button>
              </div>
            </div>
          </section>

          <section className="card" style={{gridColumn:'1 / -1'}}>
            <h3>Staged Scans</h3>
            <div className="list">
              {scans.length===0 && <div>No scans yet.</div>}
              {scans.map(s=>(
                <div key={s.id} className="item">
                  <div>{s.serial} ({s.operator})</div>
                  <div>W1: {s.wagon1||'-'} | W2: {s.wagon2||'-'} | W3: {s.wagon3||'-'}</div>
                  <div>{s.grade} • {s.railType} • {s.spec} • {s.lengthM}m</div>
                  <div>{s.stage} • {new Date(s.timestamp).toLocaleString()}</div>
                  <button className="btn btn-outline" onClick={()=>deleteScan(s.id)}>Delete</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </>}

      <footer className="footer">
        <div>© {new Date().getFullYear()} Premium Star Graphics</div>
      </footer>
    </div>
  );
}
