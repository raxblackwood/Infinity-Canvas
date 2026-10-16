import React, { useState, useEffect } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';

interface ActivityItem {
  tileX: number;
  tileY: number;
  strokeCount: number;
  activeUsers: number;
}

interface Props {
  isOpen: boolean;
  engine: CanvasEngine | null;
  onClose: () => void;
}

export const MapOverlay: React.FC<Props> = ({ isOpen, engine, onClose }) => {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [camTile, setCamTile] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!isOpen) return;

    if (engine) {
      setCamTile({ x: engine.camera.tileX, y: engine.camera.tileY });
    }

    setLoading(true);
    fetch('/api/activity?limit=50')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setActivities(data);
        }
      })
      .catch((err) => console.error('Failed to load activity:', err))
      .finally(() => setLoading(false));
  }, [isOpen, engine]);

  if (!isOpen) return null;

  const currentTileX = engine ? engine.camera.tileX : camTile.x;
  const currentTileY = engine ? engine.camera.tileY : camTile.y;

  // Jump to busiest tile
  const handleJumpBusy = () => {
    if (!engine) return;
    if (activities.length > 0) {
      const top = activities[0];
      engine.jumpTo(top.tileX, top.tileY, 0.5, 0.5, 2048);
      onClose();
    } else {
      // Default origin if empty
      engine.jumpTo(0, 0, 0.5, 0.5, 2048);
      onClose();
    }
  };

  // Jump to random spot
  const handleJumpRandom = () => {
    if (!engine) return;
    if (activities.length > 0) {
      const randIdx = Math.floor(Math.random() * activities.length);
      const chosen = activities[randIdx];
      engine.jumpTo(chosen.tileX, chosen.tileY, 0.5, 0.5, 2048);
    } else {
      // Random coordinates between -10 and 10
      const rx = Math.floor(Math.random() * 21) - 10;
      const ry = Math.floor(Math.random() * 21) - 10;
      engine.jumpTo(rx, ry, 0.5, 0.5, 2048);
    }
    onClose();
  };

  const handleCellClick = (tx: number, ty: number) => {
    if (!engine) return;
    engine.jumpTo(tx, ty, 0.5, 0.5, 2048);
    onClose();
  };

  // Build a 5x5 grid around current tile
  const gridSize = 5;
  const halfGrid = Math.floor(gridSize / 2);
  const gridRows: { tx: number; ty: number; strokeCount: number }[][] = [];

  const activityMap = new Map<string, number>();
  for (const act of activities) {
    activityMap.set(`${act.tileX},${act.tileY}`, act.strokeCount);
  }

  const maxStrokes = activities.length > 0 ? Math.max(...activities.map((a) => a.strokeCount), 1) : 1;

  for (let dy = -halfGrid; dy <= halfGrid; dy++) {
    const row: { tx: number; ty: number; strokeCount: number }[] = [];
    for (let dx = -halfGrid; dx <= halfGrid; dx++) {
      const tx = currentTileX + dx;
      const ty = currentTileY + dy;
      const count = activityMap.get(`${tx},${ty}`) || 0;
      row.push({ tx, ty, strokeCount: count });
    }
    gridRows.push(row);
  }

  return (
    <div
      data-testid="map-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 400,
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          padding: 24,
          boxShadow: '0 24px 48px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🗺️</span>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1A' }}>World Activity Map</h2>
          </div>
          <button
            onClick={onClose}
            data-testid="btn-close-map"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 18,
              cursor: 'pointer',
              color: '#888888',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Quick Jump Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleJumpBusy}
            data-testid="btn-jump-busy"
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 14,
              backgroundColor: '#FFEDD5',
              color: '#C2410C',
              border: '1px solid #FDBA74',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span>🔥</span>
            <span>Busy Spot</span>
          </button>

          <button
            onClick={handleJumpRandom}
            data-testid="btn-jump-random"
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 14,
              backgroundColor: '#EDE9FE',
              color: '#6D28D9',
              border: '1px solid #C4B5FD',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span>🎲</span>
            <span>Random Spot</span>
          </button>
        </div>

        {/* 5x5 Radar Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 12, color: '#666666', fontWeight: 500 }}>
            Surrounding Area Radar (Center: {currentTileX}, {currentTileY})
          </div>

          <div
            data-testid="radar-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
              gap: 4,
              width: '100%',
              maxWidth: 320,
              aspectRatio: '1',
              padding: 8,
              backgroundColor: '#F8F9FA',
              borderRadius: 16,
              border: '1px solid #E5E7EB',
            }}
          >
            {gridRows.flatMap((row) =>
              row.map((cell) => {
                const isCenter = cell.tx === currentTileX && cell.ty === currentTileY;
                const ratio = Math.min(1, cell.strokeCount / maxStrokes);
                let bg = '#FFFFFF';
                if (cell.strokeCount > 0) {
                  bg = `rgba(239, 68, 68, ${0.15 + ratio * 0.85})`;
                }

                return (
                  <button
                    key={`${cell.tx},${cell.ty}`}
                    data-testid={`radar-cell-${cell.tx}-${cell.ty}`}
                    onClick={() => handleCellClick(cell.tx, cell.ty)}
                    title={`Tile (${cell.tx}, ${cell.ty}): ${cell.strokeCount} strokes. Tap to jump.`}
                    style={{
                      borderRadius: 8,
                      border: isCenter ? '2px solid #5B5BD6' : '1px solid #E5E7EB',
                      backgroundColor: bg,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 600,
                      color: cell.strokeCount > 0 ? (ratio > 0.5 ? '#FFFFFF' : '#991B1B') : '#9CA3AF',
                      position: 'relative',
                      boxShadow: isCenter ? '0 0 8px rgba(91,91,214,0.4)' : 'none',
                    }}
                  >
                    <span>{cell.tx},{cell.ty}</span>
                    {cell.strokeCount > 0 && <span style={{ fontSize: 9 }}>{cell.strokeCount}</span>}
                  </button>
                );
              })
            )}
          </div>
          <div style={{ fontSize: 11, color: '#888888' }}>Tap any tile above to jump immediately</div>
        </div>

        {/* Top Active Spots List */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Top Active Regions:
          </div>
          <div
            style={{
              maxHeight: 120,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {activities.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>
                {loading ? 'Scanning canvas activity...' : 'No active hotspots yet. Be the first to draw!'}
              </div>
            ) : (
              activities.slice(0, 5).map((act, i) => (
                <div
                  key={`${act.tileX},${act.tileY}`}
                  data-testid={`active-spot-${i}`}
                  onClick={() => handleCellClick(act.tileX, act.tileY)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 10px',
                    borderRadius: 10,
                    backgroundColor: '#F3F4F6',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#1F2937' }}>
                    Tile ({act.tileX}, {act.tileY})
                  </span>
                  <span style={{ color: '#E11D48', fontWeight: 500 }}>
                    {act.strokeCount} strokes · {act.activeUsers} user{act.activeUsers > 1 ? 's' : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
