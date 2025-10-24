// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Idle');

  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const mounted = useRef(false);

  // Camera controls (capability-driven)
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [hasZoom, setHasZoom] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);
  const [zoom, setZoom] = useState(1);

  const [hasExposureComp, setHasExposureComp] = useState(false);
  const [expMin, setExpMin] = useState(0);
  const [expMax, setExpMax] = useState(0);
  const [expStep, setExpStep] = useState(1);
  const [exposure, setExposure] = useState(0);

  const stopStream = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
        streamRef.current = null;
      }
    } catch {}
  };

  const safeResetReader = () => {
    try {
      const r = readerRef.current;
      if (r && typeof r.reset === 'function') r.reset();
    } catch {}
  };

  // Build ZXing hints for better tolerance / speed
  const buildHints = () => {
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      return hints;
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    mounted.current = true;
    readerRef.current = new BrowserMultiFormatReader(buildHints());

    return () => {
      mounted.current = false;
      safeResetReader();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Try to choose the "best" rear camera
  async function pickRearDeviceId() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      if (videos.length === 0) return undefined;

      const rear =
        videos.find((d) => /rear|back|environment/i.test(d.label)) ||
        videos.find((d) => d.label?.toLowerCase?.().includes('wide')) ||
        videos[0];

      return rear ? rear.deviceId : undefined;
    } catch {
      return undefined;
    }
  }

  // Apply advanced constraints if supported
  async function applyTrackEnhancements(track) {
    if (!track?.applyConstraints) return;

    const caps = track.getCapabilities?.() || {};
    const settings = track.getSettings?.() || {};

    // Best-effort continuous auto modes
    try {
      await track.applyConstraints({
        advanced: [
          { focusMode: 'continuous' },
          { exposureMode: 'continuous' },
          { whiteBalanceMode: 'continuous' },
        ],
      });
    } catch {}

    // Torch
    if (typeof caps.torch === 'boolean') {
      setHasTorch(true);
      try {
        await track.applyConstraints({ advanced: [{ torch: false }] });
      } catch {}
    } else {
      setHasTorch(false);
    }

    // Zoom
    const zoomCaps = caps.zoom;
    if (typeof zoomCaps === 'number' || (zoomCaps && typeof zoomCaps.min === 'number')) {
      const min = (zoomCaps.min ?? 1);
      const max = (zoomCaps.max ?? Math.max(1, settings.zoom || 1));
      setHasZoom(true);
      setZoomMin(min);
      setZoomMax(max);

      const initialZoom = Math.min(max, Math.max(min, (settings.zoom || min) * 1.5));
      setZoom(initialZoom);
      try {
        await track.applyConstraints({ advanced: [{ zoom: initialZoom }] });
      } catch {}
    } else {
      setHasZoom(false);
    }

    // Exposure compensation
    const expCaps = caps.exposureCompensation;
    if (expCaps && (typeof expCaps.min === 'number' || typeof expCaps.max === 'number')) {
      const { min = -2, max = 2, step = 1 } = expCaps;
      setHasExposureComp(true);
      setExpMin(min);
      setExpMax(max);
      setExpStep(step);
      setExposure(settings.exposureCompensation ?? 0);
    } else {
      setHasExposureComp(false);
    }
  }

  const startScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Camera API not supported');
      return;
    }

    setStatus('Starting camera...');
    try {
      const deviceId = await pickRearDeviceId();

      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1920 },  // high resolution for distance decoding
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: Math.min(30, Math.max(10, fps * 2)) },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!mounted.current) return;
      streamRef.current = stream;

      const track = stream.getVideoTracks?.()[0];
      await applyTrackEnhancements(track);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsInline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
      setStatus('Scanning...');

      const reader = readerRef.current;
      if (!reader) return;

      await reader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (!mounted.current) return;
        if (result) {
          const text = result.getText ? result.getText() : result.text;
          if (text && onDetected) onDetected(text);
        }
        // Ignore errors; ZXing continues scanning.
      });
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera');
      setStatus('Error starting camera');
    }
  };

  const stopScanner = () => {
    setActive(false);
    setStatus('Stopped');
    safeResetReader();
    stopStream();
  };

  // Torch toggle
  const toggleTorch = async () => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track || !track.applyConstraints) return;
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      console.warn('Torch not supported:', e?.message);
    }
  };

  // Zoom change
  const onZoomChange = async (v) => {
    const val = parseFloat(v);
    setZoom(val);
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ zoom: val }] });
    } catch (e) {
      console.warn('Zoom not supported:', e?.message);
    }
  };

  // Exposure compensation change
  const onExposureChange = async (v) => {
    const val = parseFloat(v);
    setExposure(val);
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ exposureCompensation: val }] });
    } catch (e) {
      console.warn('Exposure compensation not supported:', e?.message);
    }
  };

  // Tap to (re)focus hint: re-apply continuous focus constraints
  const onVideoClick = async () => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="status" style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>

      <video
        ref={videoRef}
        style={{ width: '100%', borderRadius: 8, background: '#000' }}
        muted
        playsInline
        autoPlay
        onClick={onVideoClick}
      />

      {/* Camera controls (only render if capability exists) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {hasTorch && (
          <button className="btn btn-outline" onClick={toggleTorch}>
            {torchOn ? 'Torch Off' : 'Torch On'}
          </button>
        )}

        {hasZoom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="status" style={{ minWidth: 44 }}>Zoom</label>
            <input
              type="range"
              min={zoomMin}
              max={zoomMax}
              step="0.1"
              value={zoom}
              onChange={(e) => onZoomChange(e.target.value)}
            />
            <span className="status">{zoom.toFixed(1)}×</span>
          </div>
        )}

        {hasExposureComp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="status" style={{ minWidth: 70 }}>Exposure</label>
            <input
              type="range"
              min={expMin}
              max={expMax}
              step={expStep || 1}
              value={exposure}
              onChange={(e) => onExposureChange(e.target.value)}
            />
            <span className="status">{exposure}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {!active ? (
          <button className="btn" onClick={startScanner}>Start Scanner</button>
        ) : (
          <button className="btn btn-outline" onClick={stopScanner}>Stop Scanner</button>
        )}
      </div>

      <div className="status" style={{ fontSize: 11, opacity: 0.7 }}>
        Tips: ensure good light (use Torch if available), increase Zoom for distance reads, and tap the preview to refocus.
      </div>
    </div>
  );
}
