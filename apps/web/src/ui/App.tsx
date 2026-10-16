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
  const [selectedReportTiles, setSelectedReportTiles] = useState<{ tileX: number; tileY: number }[]>([]);
  const [isSelectingReportTiles, setIsSelectingReportTiles] = useState(false);
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
      onTileSelectionChange: (tiles) => {
        setSelectedReportTiles(tiles);
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

  const handleOpenReport = () => {
    if (!engine) return;
    if (isSelectingReportTiles) {
      setIsReportOpen(true);
      return;
    }
    setIsSelectingReportTiles(true);
    engine.setMode('select');
    // Pre-select current center tile
    const centerTile = { tileX: engine.camera.tileX, tileY: engine.camera.tileY };
    engine.setSelectedTiles([centerTile]);
    setSelectedReportTiles([centerTile]);
  };

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

      {/* Tile Selection Floating Banner */}
      {isSelectingReportTiles && !isReportOpen && (
        <div
          data-testid="tile-selection-bar"
          style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(26, 26, 32, 0.94)',
            backdropFilter: 'blur(16px)',
            color: '#FFFFFF',
            padding: '8px 16px',
            borderRadius: 24,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 300,
            fontSize: 13,
            maxWidth: 'calc(100vw - 32px)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 16 }}>🚩</span>
          <span style={{ fontWeight: 500 }}>
            {selectedReportTiles.length === 0
              ? 'Click or drag across canvas to select tiles'
              : `${selectedReportTiles.length} tile${selectedReportTiles.length > 1 ? 's' : ''} selected`}
          </span>

          <button
            onClick={() => setIsReportOpen(true)}
            data-testid="btn-confirm-report-selection"
            disabled={selectedReportTiles.length === 0}
            style={{
              padding: '6px 14px',
              borderRadius: 14,
              backgroundColor: '#DC2626',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 600,
              fontSize: 12,
              cursor: selectedReportTiles.length === 0 ? 'not-allowed' : 'pointer',
              opacity: selectedReportTiles.length === 0 ? 0.5 : 1,
            }}
          >
            Report Selected ({selectedReportTiles.length})
          </button>

          {selectedReportTiles.length > 0 && (
            <button
              onClick={() => {
                engine?.clearSelectedTiles();
                setSelectedReportTiles([]);
              }}
              data-testid="btn-clear-report-selection"
              style={{
                padding: '6px 10px',
                borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.12)',
                color: '#E5E7EB',
                border: 'none',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}

          <button
            onClick={() => {
              setIsSelectingReportTiles(false);
              engine?.clearSelectedTiles();
              setSelectedReportTiles([]);
              engine?.setMode('draw');
            }}
            data-testid="btn-cancel-report-selection"
            title="Cancel selection"
            style={{
              padding: '6px 10px',
              borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.12)',
              color: '#9CA3AF',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      )}

      <Toolbar
        engine={engine}
        isReportSelecting={isSelectingReportTiles}
        onOpenReport={handleOpenReport}
        onOpenAdmin={() => setIsAdminOpen(true)}
      />
      <ReportModal
        engine={engine}
        isOpen={isReportOpen}
        tiles={selectedReportTiles}
        onClose={() => setIsReportOpen(false)}
        onSuccess={(_autoQuarantined) => {
          setIsSelectingReportTiles(false);
          engine?.clearSelectedTiles();
          setSelectedReportTiles([]);
          engine?.setMode('draw');
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
