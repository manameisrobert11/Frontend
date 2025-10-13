// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const [scanner, setScanner] = useState(null);
  const [active, setActive] = useState(false);

  // Start camera and scanner
  const startScanner = async () => {
    if (active) return;
    setActive(true);

    const codeReader = new BrowserMultiFormatReader();
    setScanner(codeReader);

    try {
      const videoInputDevices = await codeReader.listVideoInputDevices();
      const deviceId = videoInputDevices[0]?.deviceId;
      if (!deviceId) throw new Error("No camera found");

      codeReader.decodeFromVideoDevice(
        deviceId,
        videoRef.current,
        (result, err) => {
          if (result) {
            onDetected(result.getText());
          }
          // Ignore decode errors, they are normal while scanning
        }
      );
    } catch (err) {
      console.error("Scanner start failed:", err);
      setActive(false);
    }
  };

  const stopScanner = () => {
    if (scanner) {
      scanner.reset();
      setScanner(null);
    }
    setActive(false);
  };

  // Stop scanner when unmounted
  useEffect(() => {
    return () => stopScanner();
  }, []);

  return (
    <div>
      <div style={{ position: "relative" }}>
        <video
          ref={videoRef}
          style={{
            width: "100%",
            maxHeight: 400,
            borderRadius: 6,
            background: "#000",
          }}
        />
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="btn btn-outline" onClick={startScanner} disabled={active}>
          Start Scan
        </button>
        <button className="btn btn-outline" onClick={stopScanner} disabled={!active}>
          Stop Scan
        </button>
      </div>
    </div>
  );
}
