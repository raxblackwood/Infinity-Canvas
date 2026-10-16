import React, { useState, useEffect } from 'react';
import { PALETTE, BRUSH_WIDTHS, ErrorCode } from '@infinite-canvas/shared';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { InteractionMode } from '../engine/PointerCapture.js';

interface Props {
  engine: CanvasEngine | null;
  isReportSelecting?: boolean;
  onOpenReport?: () => void;
  onOpenAdmin?: () => void;
  onOpenMap?: () => void;
  onOpenExport?: () => void;
  onOpenInfo?: () => void;
  onShareLocation?: () => void;
}

export const Toolbar: React.FC<Props> = ({
  engine,
  isReportSelecting,
  onOpenReport,
  onOpenAdmin,
  onOpenMap,
  onOpenExport,
  onOpenInfo,
  onShareLocation,
}) => {
  const [mode, setMode] = useState<InteractionMode>('draw');
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedWidth, setSelectedWidth] = useState(2); // default 256 units
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [ink, setInk] = useState(100);
  const [toast, setToast] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);

  useEffect(() => {
    if (!engine) return;

    if (engine.network) {
      setInk(engine.network.currentInk);
      engine.network.onInkChange = (newInk) => {
        setInk(newInk);
      };

      engine.network.onTileFrozen = (tx, ty) => {
        showToastNotice(`Tile (${tx}, ${ty}) reached 20,000 stroke cap and is now frozen!`);
      };

      engine.network.onStrokeReject = (_clientStrokeId, code) => {
        if (code === ErrorCode.INK_EMPTY) {
          showToastNotice('Out of ink! Refilling 1 token every 2s...');
        } else if (code === ErrorCode.TILE_FULL) {
          showToastNotice('Tile is full and frozen!');
        } else if (code === ErrorCode.READ_ONLY) {
          showToastNotice('Canvas is currently in read-only mode.');
        } else if (code === ErrorCode.BAD_STROKE) {
          showToastNotice('Stroke rejected: invalid stroke geometry.');
        } else {
          showToastNotice(`Stroke rejected (error code ${code})`);
        }
      };

      engine.network.onReadOnlyChange = (ro) => {
        setIsReadOnly(ro);
      };

      if (engine.network.welcomeInfo?.readOnly) {
        setIsReadOnly(true);
      }
    }
  }, [engine]);

  const showToastNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const toggleMode = () => {
    const next = mode === 'draw' ? 'move' : 'draw';
    setMode(next);
    engine?.setMode(next);
  };

  const selectColor = (idx: number) => {
    setSelectedColor(idx);
    engine?.setColor(idx);
    setShowColorPicker(false);
  };

  const selectWidth = (idx: number) => {
    setSelectedWidth(idx);
    engine?.setWidth(idx);
    setShowSizePicker(false);
  };

  const resetView = () => {
    if (!engine) return;
    engine.camera.tileX = 0;
    engine.camera.tileY = 0;
    engine.camera.offsetX = 0.5;
    engine.camera.offsetY = 0.5;
    engine.setScale(2048);
  };

  const handleUndo = () => {
    if (!engine?.network || !engine.network.isConnected) {
      showToastNotice('Not connected to canvas');
      return;
    }
    engine.network.sendUndo();
  };

  const handleShare = () => {
    if (onShareLocation) {
      onShareLocation();
    } else {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => showToastNotice('Location link copied to clipboard!'))
        .catch(() => showToastNotice('Failed to copy link to clipboard'));
    }
  };

  return (
    <>
      {/* Toast Notification Banner */}
      {toast && (
        <div
          data-testid="toast-notification"
          style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#1E1E24',
            color: '#FFFFFF',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            zIndex: 200,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>⚠️</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Read-Only Status Banner */}
      {isReadOnly && (
        <div
          data-testid="readonly-banner"
          style={{
            position: 'absolute',
            top: 60,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#F59E0B',
            color: '#FFFFFF',
            padding: '4px 14px',
            borderRadius: 14,
            fontSize: 12,
            fontWeight: 600,
            zIndex: 150,
          }}
        >
          🔒 Read-Only Mode Active
        </div>
      )}

      {/* Embedded CSS for Buttons and Responsive Layout */}
      <style>{`
        .canvas-glass-pill {
          background-color: rgba(255, 255, 255, 0.90);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-radius: 20px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid rgba(0, 0, 0, 0.08);
          display: flex;
          align-items: center;
          user-select: none;
        }
        .canvas-pill-btn {
          background: transparent;
          border: none;
          border-radius: 12px;
          padding: 6px 10px;
          min-height: 34px;
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
          transition: background-color 150ms ease-out, transform 100ms ease-out;
          touch-action: manipulation;
        }
        .canvas-pill-btn:hover {
          background-color: rgba(0, 0, 0, 0.05);
        }
        .canvas-pill-btn:active {
          transform: scale(0.96);
        }
        .canvas-divider {
          width: 1px;
          height: 18px;
          background-color: rgba(0, 0, 0, 0.1);
          margin: 0 2px;
          flex-shrink: 0;
        }
        @media (max-width: 640px) {
          .canvas-btn-label {
            display: none !important;
          }
          .canvas-pill-btn {
            padding: 6px 8px !important;
          }
          .canvas-glass-pill {
            padding: 3px 4px !important;
          }
        }
      `}</style>

      {/* Top-Left Header: Rules & Admin */}
      <div
        className="canvas-glass-pill"
        style={{
          position: 'absolute',
          top: 'max(14px, env(safe-area-inset-top, 14px))',
          left: 'max(14px, env(safe-area-inset-left, 14px))',
          padding: '4px 6px',
          gap: 4,
          zIndex: 80,
        }}
      >
        {onOpenInfo && (
          <button
            onClick={onOpenInfo}
            data-testid="btn-info"
            title="Rules & Canvas Guide"
            className="canvas-pill-btn"
          >
            <span style={{ fontSize: 15 }}>ℹ️</span>
            <span className="canvas-btn-label">Rules</span>
          </button>
        )}

        {onOpenAdmin && (
          <>
            <div className="canvas-divider" />
            <button
              onClick={onOpenAdmin}
              data-testid="btn-admin"
              title="Admin Dashboard"
              className="canvas-pill-btn"
              style={{ color: '#5B5BD6' }}
            >
              <span style={{ fontSize: 15 }}>🛡️</span>
              <span className="canvas-btn-label">Admin</span>
            </button>
          </>
        )}
      </div>

      {/* Top-Right Header: Map, Export, Share, Report */}
      <div
        className="canvas-glass-pill"
        style={{
          position: 'absolute',
          top: 'max(14px, env(safe-area-inset-top, 14px))',
          right: 'max(14px, env(safe-area-inset-right, 14px))',
          padding: '4px 6px',
          gap: 4,
          zIndex: 80,
        }}
      >
        {onOpenMap && (
          <button
            onClick={onOpenMap}
            data-testid="btn-map"
            title="Activity Map & Radar"
            className="canvas-pill-btn"
          >
            <span style={{ fontSize: 15 }}>🗺️</span>
            <span className="canvas-btn-label">Map</span>
          </button>
        )}

        {onOpenExport && (
          <button
            onClick={onOpenExport}
            data-testid="btn-export"
            title="Export High-Res Image"
            className="canvas-pill-btn"
          >
            <span style={{ fontSize: 15 }}>🖼️</span>
            <span className="canvas-btn-label">Export</span>
          </button>
        )}

        <button
          onClick={handleShare}
          data-testid="btn-share"
          title="Share Location"
          className="canvas-pill-btn"
        >
          <span style={{ fontSize: 15 }}>🔗</span>
          <span className="canvas-btn-label">Share</span>
        </button>

        {onOpenReport && (
          <>
            <div className="canvas-divider" />
            <button
              onClick={onOpenReport}
              data-testid="btn-report"
              title="Report Content"
              className="canvas-pill-btn"
              style={{
                backgroundColor: isReportSelecting ? '#FEE2E2' : 'transparent',
                color: '#DC2626',
              }}
            >
              <span style={{ fontSize: 15 }}>🚩</span>
              <span className="canvas-btn-label">
                {isReportSelecting ? 'Selecting...' : 'Report'}
              </span>
            </button>
          </>
        )}
      </div>

      {/* Color Swatch Popover */}
      {showColorPicker && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            padding: 12,
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            border: '1px solid rgba(0,0,0,0.08)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 38px)',
            gap: 8,
            zIndex: 100,
          }}
        >
          {PALETTE.map((col) => (
            <button
              key={col.index}
              onClick={() => selectColor(col.index)}
              title={col.name}
              style={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                backgroundColor: col.hex,
                border: selectedColor === col.index ? '3px solid #5B5BD6' : '1px solid rgba(0,0,0,0.15)',
                boxShadow: selectedColor === col.index ? '0 0 0 2px white' : 'none',
                cursor: 'pointer',
                transition: 'transform 100ms ease',
              }}
            />
          ))}
        </div>
      )}

      {/* Brush Size Popover */}
      {showSizePicker && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderRadius: 20,
            padding: '12px 16px',
            boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            border: '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 100,
          }}
        >
          {BRUSH_WIDTHS.map((width, idx) => {
            const visualSize = 6 + idx * 4;
            return (
              <button
                key={width}
                onClick={() => selectWidth(idx)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: selectedWidth === idx ? '#F0F0FF' : 'transparent',
                  border: selectedWidth === idx ? '2px solid #5B5BD6' : '1px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: visualSize,
                    height: visualSize,
                    borderRadius: '50%',
                    backgroundColor: PALETTE[selectedColor]?.hex || '#1A1A1A',
                  }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Primary Bottom Drawing Toolbar */}
      <div
        className="canvas-glass-pill"
        style={{
          position: 'absolute',
          bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '6px 10px',
          gap: 6,
          zIndex: 90,
          whiteSpace: 'nowrap',
        }}
      >
        {/* Ink Meter */}
        <div
          data-testid="ink-meter"
          title={`Ink remaining: ${ink}/100`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 8px',
            borderRadius: 14,
            backgroundColor: ink < 20 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(91, 91, 214, 0.08)',
            fontSize: 13,
            fontWeight: 700,
            color: ink < 20 ? '#DC2626' : '#5B5BD6',
            flexShrink: 0,
          }}
        >
          <span>💧</span>
          <span>{ink}</span>
        </div>

        <div className="canvas-divider" />

        {/* Undo Button */}
        <button
          onClick={handleUndo}
          data-testid="btn-undo"
          title="Undo last stroke (within 30s)"
          className="canvas-pill-btn"
          style={{
            backgroundColor: '#F0F0F5',
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 'bold' }}>↺</span>
          <span className="canvas-btn-label">Undo</span>
        </button>

        <div className="canvas-divider" />

        {/* Color Button */}
        <button
          onClick={() => {
            setShowColorPicker(!showColorPicker);
            setShowSizePicker(false);
          }}
          title="Choose Color"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: PALETTE[selectedColor]?.hex || '#1A1A1A',
            border: '2px solid #FFFFFF',
            boxShadow: '0 0 0 1.5px rgba(0,0,0,0.18)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'transform 100ms ease',
          }}
        />

        {/* Brush Size Button */}
        <button
          onClick={() => {
            setShowSizePicker(!showSizePicker);
            setShowColorPicker(false);
          }}
          title="Choose Brush Size"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: '#F4F4F6',
            border: '1px solid rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'transform 100ms ease',
          }}
        >
          <div
            style={{
              width: 4 + selectedWidth * 3,
              height: 4 + selectedWidth * 3,
              borderRadius: '50%',
              backgroundColor: '#1A1A1A',
            }}
          />
        </button>

        <div className="canvas-divider" />

        {/* Draw / Move Toggle */}
        <button
          onClick={toggleMode}
          title={mode === 'draw' ? 'Switch to Move tool' : 'Switch to Draw tool'}
          className="canvas-pill-btn"
          style={{
            backgroundColor: mode === 'draw' ? '#5B5BD6' : '#F0F0F5',
            color: mode === 'draw' ? '#FFFFFF' : '#1A1A1A',
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 15 }}>{mode === 'draw' ? '✏️' : '✋'}</span>
          <span className="canvas-btn-label">{mode === 'draw' ? 'Draw' : 'Move'}</span>
        </button>

        {/* Reset View Button */}
        <button
          onClick={resetView}
          title="Reset View to Origin (0, 0)"
          className="canvas-pill-btn"
          style={{
            backgroundColor: '#F0F0F5',
            fontWeight: 600,
          }}
        >
          <span style={{ fontSize: 14 }}>🎯</span>
          <span className="canvas-btn-label">(0,0)</span>
        </button>
      </div>
    </>
  );
};
