// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

/**
 * Scanner component
 * Props:
 *  - onDetected: (text: string) => void
 *  - fps?: number (scan callback pacing)
 */
export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const trackRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('Idle');
  const [torchOn, setTorchOn] = useState(false);

  // simple de-dupe for rapid repeats
  const lastScanRef = useRef({ text: '', time: 0 });

  // List cameras on mount
  useEffect(() => {
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(cams);
        if (cams?.length && !deviceId) setDeviceId(cams[0].deviceId);
      } catch (e) {
        setMessage(`Camera list error: ${e?.message || e}`);
      }
    })();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start scanning when deviceId changes and active
  useEffect(() => {
    if (active && deviceId) {
      start(deviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const start = async (id) => {
    stop();
    setMessage('Starting camera…');
    try {
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      await reader.decodeFromVideoDevice(id, videoRef.current, (result, err, controls) => {
        if (controls && !trackRef.current) {
          // save the MediaStreamTrack for torch
          const tracks = controls.stream?.getVideoTracks?.();
          if (tracks && tracks[0]) trackRef.current = tracks[0];
        }
        if (result) {
          const text = result.getText();
          const now = Date.now();
          if (
            text &&
            (text !== lastScanRef.current.text || now - lastScanRef.current.time > 1500)
          ) {
            lastScanRef.current = { text, time: now };
            onDetected && onDetected(text);
          }
        }
        // throttle UI messages
        if (err && err.name !== 'NotFoundException') {
          setMessage(err.message || String(err));
        } else {
          setMessage('Scanning…');
        }
      });

      setActive(true);
    } catch (e) {
      setMessage(`Start error: ${e?.message || e}`);
      setActive(false);
    }
  };

  const stop = () => {
    try {
      readerRef.current?.reset();
      readerRef.current = null;
    } catch {}
    try {
      if (trackRef.current) {
        trackRef.current.stop?.();
        trackRef.current = null;
      }
    } catch {}
    setActive(false);
    setMessage('Stopped');
  };

  const toggle = () => {
    if (active) stop(); else start(deviceId || undefined);
  };

  const toggleTorch = async () => {
    try {
      const track = trackRef.current;
      if (!track) return;
      const caps = track.getCapabilities?.();
      if (!caps || !('torch' in caps)) {
        setMessage('Torch not supported on this camera');
        return;
      }
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch (e) {
      setMessage(`Torch error: ${e?.message || e}`);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="input"
          style={{ maxWidth: 360 }}
          disabled={active}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
          {devices.length === 0 && <option>No cameras found</option>}
        </select>
        <button className="btn" onClick={toggle}>{active ? 'Stop' : 'Start'} Scanner</button>
        <button className="btn" onClick={toggleTorch} disabled={!active}>Toggle Torch</button>
        <span className="status" style={{ marginLeft: 8 }}>{message}</span>
      </div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', boxShadow: '0 6px 20px rgba(2,6,23,.12)' }}>
        <video
          ref={videoRef}
          style={{ width: '100%', maxHeight: 360, display: 'block', background: '#000' }}
          muted
          playsInline
        />
        {/* Simple overlay frame */}
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            boxShadow: 'inset 0 0 0 3px rgba(37,99,235,.6)'
          }}
        />
      </div>

      <div className="status" style={{ fontSize: 12 }}>
        Tip: if the camera fails to start on iPhone, ensure you are using HTTPS and granted camera permissions.
      </div>
    </div>
  );
}
