import React, { useState, useEffect } from 'react';
import { PerformanceStats } from '../engine/CanvasRenderer.js';
import { CanvasEngine } from '../engine/CanvasEngine.js';

interface Props {
  stats: PerformanceStats;
  engine: CanvasEngine | null;
}

export const PerformanceHUD: React.FC<Props> = ({ stats, engine }) => {
  const [dpr, setDpr] = useState(1);
  const [isStressRunning, setIsStressRunning] = useState(false);
  const [stressProgress, setStressProgress] = useState(0);
  const [stressReport, setStressReport] = useState<string | null>(null);
  const [showPhoneQr, setShowPhoneQr] = useState(false);

  useEffect(() => {
    setDpr(window.devicePixelRatio || 1);
  }, []);

  const handleJump = (scale: number) => {
    if (!engine) return;
    engine.setScale(scale);
  };

  const handleLoadTestPattern = () => {
    if (!engine) return;
    // Pre-populate standard test pattern:
    // 1. Center flower / concentric loops in tile (0, 0)
    // 2. Strokes crossing from tile (0, 0) into tile (1, 0) and tile (0, 1)
    // 3. Ultra fine details for zoom 16384
    const strokes = [
      // Tile 0,0 center star
      {
        id: 1001,
        tileX: 0,
        tileY: 0,
        colorIndex: 3, // Red
        widthIndex: 3, // 512 units
        points: [
          { x: 30000, y: 32768 },
          { x: 32768, y: 30000 },
          { x: 35536, y: 32768 },
          { x: 32768, y: 35536 },
          { x: 30000, y: 32768 },
        ],
        minX: 30000,
        minY: 30000,
        maxX: 35536,
        maxY: 35536,
      },
      // Blue wavy stroke crossing from tile 0 to tile 1 (x: 55000 -> 65535 on tile 0, then 0 -> 15000 on tile 1)
      {
        id: 1002,
        tileX: 0,
        tileY: 0,
        colorIndex: 8, // Blue
        widthIndex: 2, // 256 units
        points: [
          { x: 50000, y: 32000 },
          { x: 55000, y: 34000 },
          { x: 60000, y: 31000 },
          { x: 65535, y: 33000 },
        ],
        minX: 50000,
        minY: 31000,
        maxX: 65535,
        maxY: 34000,
      },
      {
        id: 1003,
        tileX: 1,
        tileY: 0,
        colorIndex: 8, // Blue continuation
        widthIndex: 2,
        points: [
          { x: 0, y: 33000 },
          { x: 5000, y: 35000 },
          { x: 10000, y: 32000 },
          { x: 15000, y: 34000 },
        ],
        minX: 0,
        minY: 32000,
        maxX: 15000,
        maxY: 35000,
      },
      // Green stroke crossing vertical border from tile (0, 0) to tile (0, 1)
      {
        id: 1004,
        tileX: 0,
        tileY: 0,
        colorIndex: 6, // Green
        widthIndex: 4, // 1024 units
        points: [
          { x: 32768, y: 55000 },
          { x: 33500, y: 60000 },
          { x: 32768, y: 65535 },
        ],
        minX: 32768,
        minY: 55000,
        maxX: 33500,
        maxY: 65535,
      },
      {
        id: 1005,
        tileX: 0,
        tileY: 1,
        colorIndex: 6, // Green continuation
        widthIndex: 4,
        points: [
          { x: 32768, y: 0 },
          { x: 32000, y: 5000 },
          { x: 32768, y: 10000 },
        ],
        minX: 32000,
        minY: 0,
        maxX: 32768,
        maxY: 10000,
      },
      // High-precision micro text / hair-lines for MAX_SCALE (16384)
      {
        id: 1006,
        tileX: 0,
        tileY: 0,
        colorIndex: 0, // Black
        widthIndex: 0, // 64 units (hairline)
        points: [
          { x: 32700, y: 32700 },
          { x: 32720, y: 32700 },
          { x: 32720, y: 32740 },
          { x: 32740, y: 32740 },
          { x: 32740, y: 32700 },
          { x: 32760, y: 32700 },
        ],
        minX: 32700,
        minY: 32700,
        maxX: 32760,
        maxY: 32740,
      },
    ];

    for (const stroke of strokes) {
      engine.addPredefinedStroke(stroke);
    }
  };

  // Run 2-minute pan stress test
  const runStressTest = () => {
    if (!engine || isStressRunning) return;
    setIsStressRunning(true);
    setStressReport(null);

    const startTime = performance.now();
    const durationMs = 120 * 1000; // 2 minutes
    const fpsSamples: number[] = [];
    const frameTimes: number[] = [];
    let maxMemory = 0;

    const interval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setStressProgress(progress);

      // Continuous pan across tile boundaries
      const angle = (elapsed / 1000) * 1.5;
      const dx = Math.cos(angle) * 14;
      const dy = Math.sin(angle) * 14;
      engine.camera.pan(dx, dy);
      engine.renderer.markDirty();

      fpsSamples.push(stats.fps);
      frameTimes.push(stats.frameTimeMs);
      if (stats.memoryUsedMB > maxMemory) {
        maxMemory = stats.memoryUsedMB;
      }

      if (elapsed >= durationMs) {
        clearInterval(interval);
        setIsStressRunning(false);

        const avgFps = Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length);
        const minFps = Math.min(...fpsSamples.filter((f) => f > 0));
        const avgFrameTime = (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(2);
        const maxFrameTime = Math.max(...frameTimes).toFixed(2);

        setStressReport(
          `2-Min Stress Pan Complete: Avg FPS: ${avgFps} (Min: ${minFps}) | Avg Frame: ${avgFrameTime}ms (Max: ${maxFrameTime}ms) | Max Memory: ${maxMemory} MB`
        );
      }
    }, 16);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 100,
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(12px)',
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        fontSize: 12,
        color: '#1A1A1A',
        maxWidth: 320,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>Performance HUD</span>
        <span style={{ color: stats.fps >= 55 ? '#2E7D32' : '#D32F2F', fontWeight: 800 }}>
          {stats.fps} FPS
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', marginBottom: 6 }}>
        <div>Frame: <strong>{stats.frameTimeMs} ms</strong></div>
        <div>Scale: <strong>{stats.scale} px</strong></div>
        <div>ZQ: <strong>{stats.zq !== null ? stats.zq : 'N/A (< 512)'}</strong></div>
        <div>DPR: <strong>{dpr}x</strong></div>
        <div>Cells: <strong>{stats.visibleCells} / {stats.cachedCells}</strong></div>
        <div>Memory: <strong>{stats.memoryUsedMB} MB</strong></div>
      </div>

      <div style={{ borderTop: '1px solid #E0E0E0', paddingTop: 6, marginTop: 4 }}>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontWeight: 600 }}>Zoom Stops (Amendment 1):</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {[256, 512, 1024, 2048, 8192, 16384].map((scale) => (
            <button
              key={scale}
              onClick={() => handleJump(scale)}
              style={{
                fontSize: 11,
                padding: '3px 6px',
                borderRadius: 4,
                border: '1px solid #ccc',
                backgroundColor: stats.scale === scale ? '#5B5BD6' : '#fff',
                color: stats.scale === scale ? '#fff' : '#333',
                cursor: 'pointer',
              }}
            >
              {scale < 512 ? `<512` : scale}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #E0E0E0', paddingTop: 6 }}>
        <button
          onClick={handleLoadTestPattern}
          style={{
            flex: 1,
            fontSize: 11,
            padding: '5px',
            borderRadius: 6,
            backgroundColor: '#F0F0F5',
            border: '1px solid #D1D1DB',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Load Test Strokes
        </button>
        <button
          onClick={runStressTest}
          disabled={isStressRunning}
          style={{
            flex: 1,
            fontSize: 11,
            padding: '5px',
            borderRadius: 6,
            backgroundColor: isStressRunning ? '#E0E0E0' : '#5B5BD6',
            color: isStressRunning ? '#666' : '#FFF',
            border: 'none',
            cursor: isStressRunning ? 'default' : 'pointer',
            fontWeight: 600,
          }}
        >
          {isStressRunning ? `Stress: ${stressProgress}%` : '2-Min Pan Stress'}
        </button>
      </div>

      <div style={{ marginTop: 6, borderTop: '1px solid #E0E0E0', paddingTop: 6 }}>
        <button
          onClick={() => setShowPhoneQr(!showPhoneQr)}
          style={{
            width: '100%',
            fontSize: 11,
            padding: '5px',
            borderRadius: 6,
            backgroundColor: '#E8EAF6',
            color: '#283593',
            border: '1px solid #C5CAE9',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {showPhoneQr ? 'Hide Phone QR' : '📱 Scan to Open on Phone'}
        </button>
        {showPhoneQr && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://knit-nut-mere-performing.trycloudflare.com"
              alt="Scan QR"
              style={{ width: 140, height: 140, borderRadius: 8, border: '1px solid #ddd' }}
            />
            <div style={{ fontSize: 11, marginTop: 4, color: '#333', wordBreak: 'break-all' }}>
              <strong>https://knit-nut-mere-performing.trycloudflare.com</strong>
            </div>
            <div style={{ fontSize: 10, color: '#666' }}>Works on Wi-Fi or Mobile Data (No password)</div>
          </div>
        )}
      </div>

      {stressReport && (
        <div
          style={{
            marginTop: 6,
            padding: 6,
            backgroundColor: '#E8F5E9',
            borderRadius: 4,
            fontSize: 10,
            color: '#1B5E20',
          }}
        >
          {stressReport}
        </div>
      )}
    </div>
  );
};
