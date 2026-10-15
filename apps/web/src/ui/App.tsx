import React, { useEffect, useRef, useState } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { PerformanceStats } from '../engine/CanvasRenderer.js';
import { PerformanceHUD } from './PerformanceHUD.js';
import { Toolbar } from './Toolbar.js';
import { ReportModal } from './ReportModal.js';
import { AdminDashboard } from './AdminDashboard.js';

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
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(() => {
    return (
      window.location.hash.includes('admin') ||
      window.location.search.includes('admin') ||
      window.location.pathname.startsWith('/admin')
    );
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const eng = new CanvasEngine(canvasRef.current, {
      onStatsUpdate: (newStats) => {
        setStats(newStats);
      },
    });
    engineRef.current = eng;
    setEngine(eng);
    (window as any).__CANVAS_ENGINE__ = eng;

    return () => {
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
      delete (window as any).__CANVAS_ENGINE__;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100dvh', overflow: 'hidden' }}>
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
      <PerformanceHUD stats={stats} engine={engine} />
      <Toolbar
        engine={engine}
        onOpenReport={() => setIsReportOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
      />
      <ReportModal
        engine={engine}
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        onSuccess={(_autoQuarantined) => {
          // Toast or feedback is already handled, or force refresh visible tiles
          engine?.network?.syncVisibleTiles();
        }}
      />
      <AdminDashboard
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
      />
    </div>
  );
};
