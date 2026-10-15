import React, { useEffect, useRef, useState } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { PerformanceStats } from '../engine/CanvasRenderer.js';
import { PerformanceHUD } from './PerformanceHUD.js';
import { Toolbar } from './Toolbar.js';

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<CanvasEngine | null>(null);
  const [stats, setStats] = useState<PerformanceStats>({
    fps: 60,
    frameTimeMs: 0,
    visibleCells: 0,
    cachedCells: 0,
    memoryUsedMB: 0,
    scale: 2048,
    zq: 11,
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const engine = new CanvasEngine(canvasRef.current, {
      onStatsUpdate: (newStats) => {
        setStats(newStats);
      },
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          backgroundColor: '#FBFAF7',
          touchAction: 'none',
        }}
      />
      <PerformanceHUD stats={stats} engine={engineRef.current} />
      <Toolbar engine={engineRef.current} />
    </div>
  );
};
