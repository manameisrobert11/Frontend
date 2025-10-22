// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const [active, setActive] = useState(false);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const mounted = useRef(false);

  const stopStream = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => {
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

  useEffect(() => {
    mounted.current = true;
    readerRef.current = new BrowserMultiFormatReader();
    return () => {
      mounted.current = false;
      safeResetReader();
      stopStream();
    };
  }, []);

  const startScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Camera API not supported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (!mounted.current) return;
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);

      const reader = readerRef.current;
      if (!reader) return;

      await reader.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (!mounted.current) return;
        if (result) {
          const text = result.getText ? result.getText() : result.text;
          if (text && onDetected) onDetected(text);
        }
      });
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera');
    }
  };

  const stopScanner = () => {
    setActive(false);
    stopStream();
    safeResetReader();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <video
        ref={videoRef}
        style={{ width: '100%', borderRadius: 8, background: '#000' }}
        muted
        playsInline
      />
      <div style={{ display: 'flex', gap: 8 }}>
        {!active ? (
          <button className="btn" onClick={startScanner}>Start Scanner</button>
        ) : (
          <button className="btn btn-outline" onClick={stopScanner}>Stop Scanner</button>
        )}
      </div>
    </div>
  );
}
