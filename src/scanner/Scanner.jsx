// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";

/**
 * Props:
 *  - onDetected(text: string)
 *  - fps?: number
 */
export default function Scanner({ onDetected, fps = 10 }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const trackRef = useRef(null);

  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("Idle");

  const audioCtxRef = useRef(null);
  const lastScanRef = useRef({ text: "", time: 0 });

  useEffect(() => {
    (async () => {
      try {
        const cams = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(cams || []);
        if (cams?.length) setDeviceId(cams[0].deviceId);
      } catch (e) {
        setMessage(`Camera list error: ${e?.message || e}`);
      }
    })();
    return () => stop();
  }, []);

  useEffect(() => {
    if (active && deviceId) start(deviceId);
  }, [deviceId]);

  // 🔊 Beep on successful scan
  const beep = (hz = 1500, ms = 120) => {
    try {
      const ctx = (audioCtxRef.current ||= new (window.AudioContext || window.webkitAudioContext)());
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(hz, ctx.currentTime);
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + ms / 1000 + 0.02);
    } catch {}
  };

  const start = async (id) => {
    stop();
    setMessage("Starting camera…");
    try {
      audioCtxRef.current ||= new (window.AudioContext || window.webkitAudioContext)();
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      await reader.decodeFromVideoDevice(id, videoRef.current, (result, err, controls) => {
        if (controls && !trackRef.current) {
          const tracks = controls.stream?.getVideoTracks?.();
          if (tracks && tracks[0]) trackRef.current = tracks[0];
        }

        if (result) {
          const text = result.getText();
          const now = Date.now();
          // Ignore duplicate scans within 1.5s
          if (text && (text !== lastScanRef.current.text || now - lastScanRef.current.time > 1500)) {
            lastScanRef.current = { text, time: now };
            beep();
            onDetected?.(text);
          }
          setMessage("Scanning…");
        } else if (err && err.name !== "NotFoundException") {
          setMessage(err.message || String(err));
        }
      });

      setActive(true);
      setMessage("Scanning…");
    } catch (e) {
      setMessage(`Start error: ${e?.message || e}`);
      setActive(false);
    }
  };

  const stop = () => {
    try {
      readerRef.current?.reset();
    } catch {}
    readerRef.current = null;
    try {
      trackRef.current?.stop?.();
    } catch {}
    trackRef.current = null;
    setActive(false);
    setMessage("Stopped");
  };

  const toggle = () => (active ? stop() : start(deviceId));

  const toggleTorch = async () => {
    try {
      const track = trackRef.current;
      if (!track) return setMessage("Torch not available");
      const caps = track.getCapabilities?.();
      if (!caps || !("torch" in caps)) return setMessage("Torch not supported");
      const constraints = { advanced: [{ torch: !(track.getSettings?.().torch || false) }] };
      await track.applyConstraints(constraints);
    } catch (e) {
      setMessage(`Torch error: ${e?.message}`);
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="input"
          style={{ maxWidth: 360 }}
          disabled={active}
        >
          {devices.length === 0 && <option>No cameras found</option>}
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Video device ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <button className="btn" onClick={toggle}>{active ? "Stop" : "Start"} Scanner</button>
        <button className="btn" onClick={toggleTorch} disabled={!active}>Toggle Torch</button>
        <span className="status" style={{ marginLeft: 8 }}>{message}</span>
      </div>

      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", boxShadow: "0 6px 20px rgba(2,6,23,.12)" }}>
        <video
          ref={videoRef}
          style={{ width: "100%", maxHeight: 360, display: "block", background: "#000" }}
          muted
          playsInline
        />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", boxShadow: "inset 0 0 0 3px rgba(37,99,235,.6)" }} />
      </div>

      <div className="status" style={{ fontSize: 12 }}>
        Note: focus/torch depend on device & browser. iPhone requires HTTPS for camera.
      </div>
    </div>
  );
}
