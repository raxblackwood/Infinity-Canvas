import React, { useState, useEffect } from 'react';
import { PALETTE, BRUSH_WIDTHS, ErrorCode } from '@infinite-canvas/shared';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { InteractionMode } from '../engine/PointerCapture.js';

interface Props {
  engine: CanvasEngine | null;
  isReportSelecting?: boolean;
  onOpenReport?: () => void;
  onOpenAdmin?: () => void;
}

export const Toolbar: React.FC<Props> = ({ engine, isReportSelecting, onOpenReport, onOpenAdmin }) => {
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

      {/* Color Swatch Popover */}
      {showColorPicker && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(136px + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 16,
            padding: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
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
            bottom: 'calc(136px + env(safe-area-inset-bottom, 0px))',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: 16,
            padding: '12px 16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
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

      {/* Responsive Styles for Mobile */}
      <style>{`
        .canvas-toolbar {
          gap: 8px;
          padding: 6px 14px;
          max-width: calc(100vw - 16px);
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .canvas-toolbar::-webkit-scrollbar {
          display: none;
        }
        .canvas-toolbar-btn-text {
          display: inline;
        }
        @media (max-width: 640px) {
          .canvas-toolbar {
            gap: 6px !important;
            padding: 4px 8px !important;
          }
          .canvas-toolbar-btn-text {
            display: none !important;
          }
          .canvas-toolbar-divider {
            margin: 0 1px !important;
          }
        }
      `}</style>

      {/* Main Bottom Toolbar */}
      <div
        className="canvas-toolbar"
        style={{
          position: 'absolute',
          bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(16px)',
          borderRadius: 24,
          boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
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
            padding: '4px 6px',
            borderRadius: 12,
            backgroundColor: ink < 20 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(91, 91, 214, 0.08)',
            fontSize: 12,
            fontWeight: 600,
            color: ink < 20 ? '#DC2626' : '#5B5BD6',
            flexShrink: 0,
          }}
        >
          <span>💧</span>
          <span>{ink}</span>
        </div>

        <div className="canvas-toolbar-divider" style={{ width: 1, height: 20, backgroundColor: '#E0E0E0', flexShrink: 0 }} />

        {/* Undo Button */}
        <button
          onClick={handleUndo}
          data-testid="btn-undo"
          title="Undo last stroke (within 30s)"
          style={{
            padding: '6px 8px',
            minWidth: 32,
            minHeight: 32,
            borderRadius: 14,
            backgroundColor: '#F0F0F5',
            color: '#1A1A1A',
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            flexShrink: 0,
            userSelect: 'none',
            touchAction: 'manipulation',
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1, fontWeight: 'bold' }}>↺</span>
          <span className="canvas-toolbar-btn-text">Undo</span>
        </button>

        <div className="canvas-toolbar-divider" style={{ width: 1, height: 20, backgroundColor: '#E0E0E0', flexShrink: 0 }} />

        {/* Color Button */}
        <button
          onClick={() => {
            setShowColorPicker(!showColorPicker);
            setShowSizePicker(false);
          }}
          title="Choose Color"
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            backgroundColor: PALETTE[selectedColor]?.hex || '#1A1A1A',
            border: '2px solid #FFFFFF',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />

        {/* Size Button */}
        <button
          onClick={() => {
            setShowSizePicker(!showSizePicker);
            setShowColorPicker(false);
          }}
          title="Choose Brush Size"
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            backgroundColor: '#F4F4F6',
            border: '1px solid rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
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

        <div className="canvas-toolbar-divider" style={{ width: 1, height: 20, backgroundColor: '#E0E0E0', flexShrink: 0 }} />

        {/* Draw / Move Toggle */}
        <button
          onClick={toggleMode}
          title={mode === 'draw' ? 'Switch to Move tool' : 'Switch to Draw tool'}
          style={{
            padding: '6px 10px',
            borderRadius: 14,
            backgroundColor: mode === 'draw' ? '#5B5BD6' : '#F0F0F5',
            color: mode === 'draw' ? '#FFFFFF' : '#1A1A1A',
            border: 'none',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            flexShrink: 0,
          }}
        >
          <span>{mode === 'draw' ? '✏️' : '✋'}</span>
          <span className="canvas-toolbar-btn-text">{mode === 'draw' ? 'Draw' : 'Move'}</span>
        </button>

        {/* Reset View */}
        <button
          onClick={resetView}
          title="Reset View to Center (0, 0)"
          style={{
            padding: '6px 8px',
            borderRadius: 14,
            backgroundColor: '#F0F0F5',
            color: '#1A1A1A',
            border: 'none',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexShrink: 0,
          }}
        >
          <span>🎯</span>
          <span className="canvas-toolbar-btn-text">(0,0)</span>
        </button>

        <div className="canvas-toolbar-divider" style={{ width: 1, height: 20, backgroundColor: '#E0E0E0', flexShrink: 0 }} />

        {/* Report Button */}
        {onOpenReport && (
          <button
            onClick={onOpenReport}
            data-testid="btn-report"
            title="Report inappropriate content in canvas"
            style={{
              padding: '6px 8px',
              borderRadius: 14,
              backgroundColor: isReportSelecting ? '#FEE2E2' : '#F0F0F5',
              color: '#DC2626',
              border: isReportSelecting ? '1px solid #DC2626' : 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
          >
            <span>🚩</span>
            <span className="canvas-toolbar-btn-text">{isReportSelecting ? 'Selecting...' : 'Report'}</span>
          </button>
        )}

        {/* Admin Dashboard Button */}
        {onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            data-testid="btn-admin"
            title="Open Admin Dashboard"
            style={{
              padding: '6px 8px',
              borderRadius: 14,
              backgroundColor: '#F0F0F5',
              color: '#5B5BD6',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexShrink: 0,
              userSelect: 'none',
              touchAction: 'manipulation',
            }}
          >
            <span>🛡️</span>
            <span className="canvas-toolbar-btn-text">Admin</span>
          </button>
        )}
      </div>
    </>
  );
};
