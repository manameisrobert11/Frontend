import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function Scanner({ onDetected }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(list);
        if (list?.length) setDeviceId(list[0].deviceId);
      } catch (e) {
        setErr('No camera found or permission denied');
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!deviceId || !videoRef.current) return;
      try {
        if (readerRef.current) readerRef.current.reset();
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result, e) => {
          if (!active) return;
          if (result) {
            const text = result.getText();
            onDetected?.(text);
          }
        });
      } catch (e) {
        setErr(e?.message || 'Scanner error');
      }
    })();

    return () => {
      active = false;
      readerRef.current?.reset();
    };
  }, [deviceId, onDetected]);

  // try to focus if supported
  const handleTapFocus = async () => {
    try {
      const stream = videoRef.current?.srcObject;
      const track = stream?.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.();
      if (capabilities?.focusMode && capabilities.focusMode.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } else if (capabilities?.focusDistance) {
        // nudge focus if possible
        const min = capabilities.focusDistance.min;
        const max = capabilities.focusDistance.max;
        const mid = (min + max) / 2;
        await track.applyConstraints({ advanced: [{ focusDistance: mid }] });
      }
    } catch {
      // ignore if not supported
    }
  };

  return (
    <div className="scanner">
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8}}>
        <select
          className="input"
          value={deviceId}
          onChange={e=>setDeviceId(e.target.value)}
          style={{maxWidth: '60%'}}
        >
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0,6)}…`}
            </option>
          ))}
        </select>
        <button className="btn" onClick={handleTapFocus}>Auto-focus</button>
      </div>

      <video
        ref={videoRef}
        className="video"
        playsInline
        muted
        autoPlay
        style={{width:'100%', borderRadius:16, border:'1px solid var(--line)'}}
      />

      {err && <div className="error">{err}</div>}
      <p className="hint">Aim the camera at the Barcode/QR. Try the rear camera on phones.</p>
    </div>
  );
}
