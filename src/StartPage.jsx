import React from 'react';
import './app.css';

export default function StartPage({ onContinue }) {
  // Safe no-op if not passed
  const handleStart = () => {
    if (typeof onContinue === 'function') onContinue();
  };

  return (
    <div className="start-page" style={{ padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ margin: 0 }}>Rail Inventory</h1>
        <p className="status" style={{ marginTop: 6 }}>
          Prepare to scan QR labels, review details, and stage records.
        </p>

        {/* Any other intro content you had can live here */}

        <div style={{ marginTop: 20 }}>
          <button className="btn" onClick={handleStart}>
            Start Scanning
          </button>
        </div>
      </div>
    </div>
  );
}
