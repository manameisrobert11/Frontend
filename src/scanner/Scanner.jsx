// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  BarcodeFormat,
  DecodeHintType,
  NotFoundException,
} from '@zxing/library';

/**
 * Props:
 *  - onDetected(text)  : callback with decoded string
 *  - fps               : throttle callback (default 10)
 */
export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const trackRef  = useRef(null);
  const rafRef    = useRef(null);     // for BarcodeDetector fallback
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState('Idle');
  const [torchOn, setTorchOn] = useState(false);

  const lastScanRef = useRef({ text: '', t: 0 });

  // Build strong ZXing hints for QR & common 1D/2D
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.ALSO_INVERTED, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.ITF,
  ]);

  // List cameras
  useEffect(() => {
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(cams);
        // prefer a rear/environment camera if label hints it
        const rear = cams.find(c => /back|rear|environment/i.test(c.label || ''));
        setDeviceId((rear || cams[0])?.deviceId || '');
      } catch (e) {
        setMsg(`Camera list error: ${e?.message || e}`);
      }
    })();

    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // when user selects device while active → restart
    if (active && deviceId) start(deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const start = async (id) => {
    stop();
    setMsg('Starting camera…');

    try {
      const reader = new BrowserMultiFormatReader(hints);
      // reduce decode frequency a bit; helps stability
      reader.timeBetweenDecodingAttempts = Math.max(50, 1000 / fps);
      readerRef.current = reader;

      // high-res rear camera constraints for better QR pixels
      const constraints = {
        video: {
          deviceId: id ? { exact: id } : undefined,
          facingMode: id ? undefined : { ideal: 'environment' },
          width: { ideal: 1920 },   // try 1080–2160
          height: { ideal: 1080 },
          focusMode: 'continuous',
        },
        audio: false,
      };

      await reader.decodeFromConstraints(constraints, videoRef.current, (result, err, controls) => {
        if (controls && !trackRef.current) {
          const tracks = controls.stream?.getVideoTracks?.();
          if (tracks && tracks[0]) {
            trackRef.current = tracks[0];
            // try to push continuous focus if supported
            try {
              const caps = trackRef.current.getCapabilities?.();
              if (caps?.focusMode?.includes?.('continuous')) {
                trackRef.current.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
              }
              // small zoom helps QR detection a lot if available
              if (caps?.zoom) {
                const mid = (caps.zoom.max + caps.zoom.min) / 2;
                trackRef.current.applyConstraints({ advanced: [{ zoom: Math.min(2, mid || 1.5) }] });
              }
            } catch {}
          }
        }

        if (result) {
          const text = result.getText();
          const now = Date.now();
          if (text && (text !== lastScanRef.current.text || now - lastScanRef.current.t > 1200)) {
            lastScanRef.current = { text, t: now };
            onDetected?.(text);
          }
          setMsg('Scanning…');
          return;
        }

        // Non-fatal errors while scanning
        if (err && !(err instanceof NotFoundException)) {
          setMsg(err.message || String(err));
        } else {
          setMsg('Scanning…');
        }
      });

      setActive(true);

      // Start BarcodeDetector fallback if supported
      if ('BarcodeDetector' in window) startFallbackDetector();
    } catch (e) {
      setMsg(`Start error: ${e?.message || e}`);
      setActive(false);
    }
  };

  const startFallbackDetector = async () => {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats?.();
      const want = ['qr_code', 'data_matrix', 'code_128', 'code_39', 'ean_13'].filter(f =>
        supported?.includes?.(f)
      );
      if (!want.length) return;

      const det = new window.BarcodeDetector({ formats: want });

      const tick = async () => {
        if (!active) return;
        try {
          const v = videoRef.current;
          if (v && v.readyState >= 2) {
            const barcodes = await det.detect(v);
            if (barcodes?.length) {
              const text = barcodes[0].rawValue || barcodes[0].rawValueText || '';
              if (text) {
                const now = Date.now();
                if (text !== lastScanRef.current.text || now - lastScanRef.current.t > 1200) {
                  lastScanRef.current = { text, t: now };
                  onDetected?.(text);
                }
              }
            }
          }
        } catch {}
        rafRef.current = requestAnimationFrame(tick);
      };

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(tick);
    } catch {}
  };

  const stop = () => {
    try { readerRef.current?.reset(); } catch {}
    readerRef.current = null;

    try { if (trackRef.current) trackRef.current.stop?.(); } catch {}
    trackRef.current = null;

    try { cancelAnimationFrame(rafRef.current); } catch {}
    rafRef.current = null;

    setActive(false);
    setMsg('Stopped');
  };

  const toggle = () => (active ? stop() : start(deviceId || undefined));

  const toggleTorch = async () => {
    try {
      const t = trackRef.current;
      if (!t) return;
      const caps = t.getCapabilities?.();
      if (!caps || !('torch' in caps)) return setMsg('Torch not supported on this camera');
      await t.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(v => !v);
    } catch (e) {
      setMsg(`Torch error: ${e?.message || e}`);
    }
  };

  const tapToFocus = async (x, y) => {
    try {
      const t = trackRef.current;
      if (!t) return;
      // Some Android browsers support pointsOfInterest
      await t.applyConstraints({ advanced: [{ pointsOfInterest: [{ x, y }] }] });
      setMsg('Focus requested');
    } catch (e) {
      setMsg(`Focus error: ${e?.message || e}`);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
          {!devices.length && <option>No cameras found</option>}
        </select>

        <button className="btn" onClick={toggle}>{active ? 'Stop' : 'Start'} Scanner</button>
        <button className="btn" onClick={toggleTorch} disabled={!active}>
          {torchOn ? 'Torch Off' : 'Torch On'}
        </button>
        <span className="status" style={{ marginLeft: 8 }}>{msg}</span>
      </div>

      <div
        style={{ position: 'relative', borderRadius: 16, overflow: 'hidden',
                 boxShadow: '0 6px 20px rgba(2,6,23,.12)' }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          tapToFocus((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
        title="Tap to focus"
      >
        <video
          ref={videoRef}
          style={{ width: '100%', maxHeight: 360, display: 'block', background: '#000' }}
          muted
          playsInline
        />
        {/* scan frame */}
        <div style={{
          position:'absolute', inset: '10% 15%',
          border: '3px solid rgba(37,99,235,.7)', borderRadius: 12, pointerEvents:'none'
        }}/>
      </div>

      <div className="status" style={{ fontSize: 12 }}>
        Tip: Use good lighting, fill the frame (QR ~ 50–70% width), and try the rear camera. iPhone requires HTTPS.
      </div>
    </div>
  );
}
