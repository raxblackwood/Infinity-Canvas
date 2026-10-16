import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { PerformanceStats } from '../engine/CanvasRenderer.js';
import { PerformanceHUD } from './PerformanceHUD.js';
import { Toolbar } from './Toolbar.js';
import { ReportModal } from './ReportModal.js';
import { AdminDashboard } from './AdminDashboard.js';
import { OnboardingModal } from './OnboardingModal.js';
import { MapOverlay } from './MapOverlay.js';
import { ExportModal } from './ExportModal.js';

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
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // First-run rules acceptance
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => {
    return !localStorage.getItem('rules_accepted_v1');
  });
  const [isFirstRun, setIsFirstRun] = useState(() => {
    return !localStorage.getItem('rules_accepted_v1');
  });

  const [isAdminOpen, setIsAdminOpen] = useState(() => {
    return (
      window.location.hash.includes('admin') ||
      window.location.search.includes('admin') ||
      window.location.pathname.startsWith('/admin')
    );
  });

  // Developer HUD hidden by default; enabled via ?debug=1, #debug, or pressing 'H'
  const [showHUD, setShowHUD] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.search.includes('debug') ||
      window.location.hash.includes('debug')
    );
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setShowHUD((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const urlUpdateTimer = useRef<number | null>(null);

  // Debounced URL hash update for deep linking
  const handleCameraChange = useCallback(
    (cam: { tileX: number; tileY: number; offsetX: number; offsetY: number; scale: number }) => {
      if (urlUpdateTimer.current !== null) {
        window.clearTimeout(urlUpdateTimer.current);
      }
      urlUpdateTimer.current = window.setTimeout(() => {
        // Only update hash if not in admin modal
        if (!window.location.hash.includes('admin')) {
          const roundedScale = Math.round(cam.scale);
          window.history.replaceState(null, '', `#t=${cam.tileX},${cam.tileY}@${roundedScale}`);
        }
      }, 250);
    },
    []
  );

  useEffect(() => {
    if (!canvasRef.current) return;

    const eng = new CanvasEngine(canvasRef.current, {
      onStatsUpdate: (newStats) => {
        setStats(newStats);
      },
      onTileSelectionChange: (tiles) => {
        setSelectedReportTiles(tiles);
      },
      onCameraChange: (cam) => {
        handleCameraChange(cam);
      },
    });

    engineRef.current = eng;
    setEngine(eng);
    (window as any).__CANVAS_ENGINE__ = eng;

    // Drawing disabled until rules accepted
    const hasAcceptedRules = Boolean(localStorage.getItem('rules_accepted_v1'));
    eng.setDrawingEnabled(hasAcceptedRules);

    // Deep Linking: parse URL coordinate
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(window.location.search);
    let coordsParsed = false;

    // Check search params first: ?tx=..&ty=..&scale=..
    if (searchParams.has('tx') && searchParams.has('ty')) {
      const tx = parseInt(searchParams.get('tx')!, 10);
      const ty = parseInt(searchParams.get('ty')!, 10);
      const scale = searchParams.has('scale') ? parseFloat(searchParams.get('scale')!) : 2048;
      if (!isNaN(tx) && !isNaN(ty)) {
        eng.jumpTo(tx, ty, 0.5, 0.5, isNaN(scale) ? 2048 : scale);
        coordsParsed = true;
      }
    }

    // Check hash: #t=10,-5@2048 or #10,-5@2048
    if (!coordsParsed && hash) {
      const match = hash.match(/#?(?:t=)?(-?\d+),(-?\d+)(?:@(\d+))?/);
      if (match) {
        const tx = parseInt(match[1], 10);
        const ty = parseInt(match[2], 10);
        const scale = match[3] ? parseInt(match[3], 10) : 2048;
        if (!isNaN(tx) && !isNaN(ty)) {
          eng.jumpTo(tx, ty, 0.5, 0.5, isNaN(scale) ? 2048 : scale);
          coordsParsed = true;
        }
      }
    }

    // If no explicit coordinate in URL, fetch suggested spawn location near activity
    if (!coordsParsed) {
      fetch('/api/spawn')
        .then((res) => res.json())
        .then((spawn) => {
          if (spawn && typeof spawn.tileX === 'number' && typeof spawn.tileY === 'number') {
            eng.jumpTo(
              spawn.tileX,
              spawn.tileY,
              spawn.offsetX ?? 0.5,
              spawn.offsetY ?? 0.5,
              spawn.scale ?? 2048
            );
          }
        })
        .catch((err) => console.warn('Spawn location fetch error:', err));
    }

    return () => {
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
      delete (window as any).__CANVAS_ENGINE__;
    };
  }, [handleCameraChange]);

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

  const handleRulesAccepted = () => {
    setIsOnboardingOpen(false);
    if (engine) {
      engine.setDrawingEnabled(true);
    }
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
      {showHUD && (
        <PerformanceHUD
          stats={stats}
          engine={engine}
          onClose={() => setShowHUD(false)}
        />
      )}

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
        onOpenMap={() => setIsMapOpen(true)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenInfo={() => {
          setIsFirstRun(false);
          setIsOnboardingOpen(true);
        }}
      />

      <MapOverlay
        isOpen={isMapOpen}
        engine={engine}
        onClose={() => setIsMapOpen(false)}
      />

      <ExportModal
        isOpen={isExportOpen}
        engine={engine}
        onClose={() => setIsExportOpen(false)}
      />

      <OnboardingModal
        isOpen={isOnboardingOpen}
        engine={engine}
        isFirstRun={isFirstRun}
        onAccept={handleRulesAccepted}
        onClose={() => setIsOnboardingOpen(false)}
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
