// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export default function Scanner({
  onDetected,
  minIntervalMs = 500,         // ignore same code within this window
  preferFormats = ['qr_code', 'code_128', 'data_matrix'], // for BarcodeDetector
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);         // ZXing reader
  const rafRef = useRef(0);               // rAF loop id for BarcodeDetector
  const lastHitRef = useRef({ text: '', at: 0 });
  const trackRef = useRef(null);          // MediaStreamTrack (for torch / focus / zoom)

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [msg, setMsg] = useState('Idle');

  // ---- tiny beep (no asset needed) ----
  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880; // A5
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      o.start();
      setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        o.stop(ctx.currentTime + 0.12);
        ctx.close();
      }, 90);
    } catch {}
  };

  // ---- enumerate cameras on mount ----
  useEffect(() => {
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(cams);
        if (cams.length && !deviceId) setDeviceId(cams[0].deviceId);
      } catch (e) {
        setMsg(`Camera list error: ${e?.message || e}`);
      }
    })();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stop everything
  const stop = () => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    } catch {}
    try { readerRef.current?.reset(); } catch {}
    readerRef.current = null;

    try {
      streamRef.current?.getTracks?.().forEach(t => t.stop());
      streamRef.current = null;
    } catch {}
    trackRef.current = null;

    setActive(false);
    setTorchOn(false);
    setMsg('Stopped');
  };

  // apply nice camera constraints: back camera, hi-res, continuous focus
  const getConstraints = (id) => ({
    audio: false,
    video: {
      deviceId: id ? { exact: id } : undefined,
      facingMode: id ? undefined : { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
      // Some browsers honor these via applyConstraints on the track instead:
      focusMode: 'continuous',
      frameRate: { ideal: 30, max: 60 },
      advanced: [{ focusMode: 'continuous' }],
    }
  });

  // try to turn on continuous focus / zoom a bit for faster reads
  const tuneTrack = async (track) => {
    try {
      trackRef.current = track;
      const caps = track.getCapabilities?.() || {};
      const cons = track.getConstraints?.() || {};
      const advanced = [];

      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (caps.zoom && typeof caps.zoom.min === 'number') {
        const midZoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, (caps.zoom.max * 0.3)));
        advanced.push({ zoom: midZoom });
      }

      if (advanced.length) await track.applyConstraints({ ...cons, advanced });
    } catch {}
  };

  // ---- BarcodeDetector fast path ----
  const startWithBarcodeDetector = async () => {
    setMsg('Starting (BarcodeDetector)…');
    const constraints = getConstraints(deviceId);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    await tuneTrack(track);

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }

    const detector = new window.BarcodeDetector({ formats: preferFormats });
    setActive(true);
    setMsg('Scanning…');

    const loop = async () => {
      if (!videoRef.current || !streamRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        if (codes?.length) {
          // take the longest text (QR sometimes returns multiple)
          const best = codes
            .map(c => (c.rawValue || '').trim())
            .filter(Boolean)
            .sort((a,b)=>b.length-a.length)[0];

          if (best) {
            const now = performance.now();
            const { text, at } = lastHitRef.current;
            if (best !== text || (now - at) > minIntervalMs) {
              lastHitRef.current = { text: best, at: now };
              beep();
              onDetected?.(best);
            }
          }
        }
      } catch (e) {
        // If detector fails repeatedly, we’ll fall back when user restarts
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  // ---- ZXing fallback ----
  const startWithZXing = async () => {
    setMsg('Starting (ZXing)…');

    // Hints for speed/robustness
    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.ALSO_INVERTED, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
    ]);

    const reader = new BrowserMultiFormatReader(hints);
    reader.timeBetweenDecodingAttempts = 50; // ~20fps
    readerRef.current = reader;

    await reader.decodeFromVideoDevice(deviceId || undefined, videoRef.current, (result, err, controls) => {
      if (controls && !trackRef.current) {
        const tracks = controls.stream?.getVideoTracks?.();
        if (tracks && tracks[0]) tuneTrack(tracks[0]);
      }
      if (result) {
        const best = result.getText();
        const now = performance.now();
        const { text, at } = lastHitRef.current;
        if (best && (best !== text || (now - at) > minIntervalMs)) {
          lastHitRef.current = { text: best, at: now };
          beep();
          onDetected?.(best);
        }
        setMsg('Scanning…');
      } else if (err && err.name !== 'NotFoundException') {
        setMsg(err.message || String(err));
      } else {
        setMsg('Scanning…');
      }
    });

    setActive(true);
  };

  const start = async () => {
    stop();
    try {
      if ('BarcodeDetector' in window) {
        await startWithBarcodeDetector();
      } else {
        await startWithZXing();
      }
    } catch (e) {
      setMsg(`Start error: ${e?.message || e}`);
      setActive(false);
    }
  };

  const toggle = () => (active ? stop() : start());

  const toggleTorch = async () => {
    try {
      const track = trackRef.current;
      if (!track) return setMsg('Torch not ready');
      const caps = track.getCapabilities?.();
      if (!caps || !('torch' in caps)) return setMsg('Torch not supported');
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(v => !v);
    } catch (e) {
      setMsg(`Torch error: ${e?.message || e}`);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          className="input"
          style={{ minWidth: 240, maxWidth: 360 }}
          disabled={active}
        >
          {devices.length === 0 && <option>No cameras found</option>}
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button className="btn" onClick={toggle}>{active ? 'Stop' : 'Start'} Scanner</button>
        <button className="btn" onClick={toggleTorch} disabled={!active}>Toggle Torch</button>
        <span className="status" style={{ marginLeft: 8 }}>{msg}</span>
      </div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', boxShadow: '0 6px 20px rgba(2,6,23,.12)' }}>
        <video
          ref={videoRef}
          style={{ width: '100%', maxHeight: 360, display: 'block', background: '#000' }}
          muted
          playsInline
        />
        {/* Scan frame overlay */}
        <div
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            boxShadow: 'inset 0 0 0 3px rgba(37,99,235,.6)'
          }}
        />
      </div>

      <div className="status" style={{ fontSize: 12 }}>
        Tip: iPhone needs HTTPS to allow camera. On dark labels, enable torch and fill most of the frame for fastest locks.
      </div>
    </div>
  );
}
