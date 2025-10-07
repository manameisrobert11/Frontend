import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

/**
 * Scanner with:
 * - Camera device selector
 * - Start / Stop
 * - Autofocus / Tap-to-Focus / Focus Near / Focus Far
 * - Error/status line + iPhone HTTPS note
 *
 * Props:
 *   onDetected(text: string)
 */
export default function Scanner({ onDetected }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  // Load camera devices on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        if (!mounted) return;
        setDevices(cams || []);
        if (cams?.length && !selectedId) setSelectedId(cams[0].deviceId);
      } catch (e) {
        setMsg(`No camera devices found (${e?.message || 'error'})`);
      }
    })();
    return () => { mounted = false; stopScanner(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startScanner = async () => {
    if (!selectedId) { setMsg('Please select a camera'); return; }
    setMsg('');
    try {
      // Stop any old reader/stream first
      await stopScanner();

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      // Ask for video stream first so we can tweak focus constraints
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedId }, facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      await videoRef.current?.play();

      // Try continuous autofocus (best effort)
      await trySetFocus('continuous');

      // Hand stream to zxing for decode
      await reader.decodeFromVideoDevice(selectedId, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText();
          onDetected?.(text);
        }
        // ignore decode errors; they happen continuously
      });

      setRunning(true);
    } catch (e) {
      setMsg(`Start error: ${friendlyErr(e)}`);
      setRunning(false);
      await stopScanner();
    }
  };

  const stopScanner = async () => {
    try {
      if (readerRef.current) {
        try { readerRef.current.reset(); } catch {}
        readerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setRunning(false);
    } catch {}
  };

  // --- Focus helpers (not all browsers/devices support these) ---
  const getVideoTrack = () => streamRef.current?.getVideoTracks?.()[0];

  const trySetFocus = async (mode, distance) => {
    const track = getVideoTrack();
    if (!track) return;
    const caps = track.getCapabilities?.();
    // Only set properties the device supports
    const constraints = { advanced: [] };
    const adv = {};
    if (caps?.focusMode && caps.focusMode.includes(mode)) adv.focusMode = mode;
    if (distance != null && caps?.focusDistance) {
      const { min, max } = caps.focusDistance;
      const clamped = Math.min(max, Math.max(min, distance));
      adv.focusDistance = clamped;
    }
    if (Object.keys(adv).length) constraints.advanced.push(adv);
    if (!constraints.advanced.length) return;
    try {
      await track.applyConstraints(constraints);
    } catch (e) {
      // best effort; some browsers throw if not supported
    }
  };

  const handleAutofocus = () => trySetFocus('continuous');
  const handleFocusNear = () => trySetFocus('manual', 0.0);  // near
  const handleFocusFar  = () => {
    const caps = getVideoTrack()?.getCapabilities?.();
    const val = caps?.focusDistance?.max ?? 1.0;
    return trySetFocus('manual', val);                        // far
  };

  const handleTapToFocus = (e) => {
    // Map click position to a focusDistance heuristic (near at top-left, far at bottom-right)
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    // farther if click toward bottom-right
    const caps = getVideoTrack()?.getCapabilities?.();
    if (!caps?.focusDistance) return;
    const { min, max } = caps.focusDistance;
    const target = min + (max - min) * ((x + y) / 2);
    trySetFocus('manual', target);
  };

  const friendlyErr = (e) => {
    const m = String(e?.message || e || '');
    if (/Permission|denied|dismissed/i.test(m)) return 'Permission dismissed';
    if (/NotAllowedError/i.test(m)) return 'Permission denied';
    if (/NotFoundError/i.test(m)) return 'No camera found';
    return m;
  };

  return (
    <div>
      {/* Top controls row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ minWidth: 220 }}
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          disabled={running}
        >
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Video device ${i + 1}`}
            </option>
          ))}
          {!devices.length && <option>Loading cameras…</option>}
        </select>

        {!running ? (
          <button className="btn" onClick={startScanner}>Start Scanner</button>
        ) : (
          <button className="btn btn-outline" onClick={stopScanner}>Stop Scanner</button>
        )}
      </div>

      {/* Focus buttons */}
      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={handleAutofocus}>Autofocus</button>
        <button className="btn" onClick={handleTapToFocus}>Tap-to-Focus</button>
        <button className="btn" onClick={handleFocusNear}>Focus Near</button>
        <button className="btn" onClick={handleFocusFar}>Focus Far</button>
      </div>

      {/* Status line */}
      <div style={{ marginTop: 8, color: 'var(--muted)' }}>
        {msg ? <>Start error: {msg}</> : ' '}
      </div>

      {/* Video box */}
      <div
        style={{
          marginTop: 12,
          background: '#0b0b12',
          border: '1px solid #0d1b2e',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 10px 24px rgba(3,27,78,.16)'
        }}
        onClick={handleTapToFocus}
        title="Tap to focus"
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', height: 260, background: 'black', objectFit: 'cover' }}
        />
      </div>

      <div style={{ marginTop: 8, color: 'var(--muted)' }}>
        Note: focus features depend on device/browser. iPhone requires HTTPS.
      </div>
    </div>
  );
}
