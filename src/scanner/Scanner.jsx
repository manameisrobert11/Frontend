// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const [active, setActive] = useState(false);
  const codeReaderRef = useRef(null);

  useEffect(() => {
    codeReaderRef.current = new BrowserMultiFormatReader();

    return () => {
      codeReaderRef.current?.reset();
      stopScanner();
    };
  }, []);

  const startScanner = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Camera API not supported');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = stream;
      videoRef.current.play();

      setActive(true);

      codeReaderRef.current.decodeFromVideoDevice(null, videoRef.current, (result, err) => {
        if (result) {
          // QR code detected
          if (onDetected) onDetected(result.getText());
        }
      });
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera');
    }
  };

  const stopScanner = () => {
    setActive(false);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    codeReaderRef.current?.reset();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <video
        ref={videoRef}
        style={{ width: '100%', borderRadius: 8, background: '#000' }}
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
