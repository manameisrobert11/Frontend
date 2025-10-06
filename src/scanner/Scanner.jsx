// frontend/src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

/**
 * Scanner with autofocus, tap-to-focus, and manual focus nudge.
 * Props:
 *  - onDetected(text: string)
 */
export default function Scanner({ onDetected }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const trackRef  = useRef(null);
  const readerRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState('Idle');

  // list cameras on mount
  useEffect(() => {
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(cams);
        if (cams?.length) setDeviceId(cams[0].deviceId);
      } catch (e) {
        setMsg(`Camera list error: ${e?.message || e}`);
      }
    })();
    return () => stop();
  }, []);

  useEffect(() => { if (active && deviceId) start(deviceId); }, [deviceId]); // eslint-disable-line

  async function start(id) {
    stop();
    setMsg('Starting camera…');
    try {
      // open camera (environment/back camera preferred)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: id ? { exact: id } : undefined,
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      // request continuous autofocus if supported
      await trySetFocusMode('continuous');

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      await reader.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText();
          onDetected?.(text);
        }
        if (err && err.name !== 'NotFoundException') setMsg(err.message || String(err));
        else setMsg('Scanning…');
      });

      setActive(true);
    } catch (e) {
      setMsg(`Start error: ${e?.message || e}`);
      setActive(false);
    }
  }

  function stop() {
    try { readerRef.current?.reset(); } catch {}
    readerRef.current = null;

    try { streamRef.current?.getTracks()?.forEach(t => t.stop()); } catch {}
    streamRef.current = null;
    trackRef.current = null;

    setActive(false);
    setMsg('Stopped');
  }

  async function trySetFocusMode(mode) {
    const track = trackRef.current;
    if (!track) return false;
    const caps = track.getCapabilities?.();
    if (!caps || !Array.isArray(caps.focusMode)) return false;
    if (!caps.focusMode.includes(mode)) return false;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: mode }] });
      return true;
    } catch { return false; }
  }

  // Tap-to-focus (single-shot if available; else auto->continuous)
  async function handleTapToFocus() {
    const ok = await trySetFocusMode('single-shot');
    if (!ok) {
      const a = await trySetFocusMode('auto');
      if (a) setTimeout(() => trySetFocusMode('continuous'), 300);
    }
  }

  // Manual focus nudge (if focusDistance is exposed)
  async function nudgeFocus(direction = 'near') {
    const track = trackRef.current;
    const caps = track?.getCapabilities?.();
    if (!track || typeof caps?.focusDistance === 'undefined') return;

    const settings = track.getSettings?.() || {};
    const cur = settings.focusDistance ?? caps.focusDistance.min;
    const step = (caps.focusDistance.max - caps.focusDistance.min) / 10;
    const next = Math.max(
      caps.focusDistance.min,
      Math.min(caps.focusDistance.max, cur + (direction === 'near' ? -step : step))
    );

    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: next }] });
    } catch {}
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          disabled={active}
          className="input"
          style={{ maxWidth: 360 }}
        >
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
          {devices.length === 0 && <option>No cameras found</option>}
        </select>

        <button className="btn" onClick={() => (active ? stop() : start(deviceId))}>
          {active ? 'Stop' : 'Start'} Scanner
        </button>
        <button className="btn" onClick={() => trySetFocusMode('continuous')} disabled={!active}>
          Autofocus
        </button>
        <button className="btn" onClick={handleTapToFocus} disabled={!active}>
          Tap-to-Focus
        </button>
        <button className="btn" onClick={() => nudgeFocus('near')} disabled={!active}>
          Focus Near
        </button>
        <button className="btn" onClick={() => nudgeFocus('far')} disabled={!active}>
          Focus Far
        </button>

        <span className="status" style={{ marginLeft: 8 }}>{msg}</span>
      </div>

      <div
        onClick={handleTapToFocus}
        style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', boxShadow: '0 6px 20px rgba(2,6,23,.12)' }}
      >
        <video
          ref={videoRef}
          style={{ width: '100%', maxHeight: 360, display: 'block', background: '#000' }}
          muted
          playsInline
        />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 0 3px rgba(37,99,235,.6)' }} />
      </div>

      <div className="status" style={{ fontSize: 12 }}>
        Note: focus features depend on device/browser. iPhone requires HTTPS.
      </div>
    </div>
  );
}
