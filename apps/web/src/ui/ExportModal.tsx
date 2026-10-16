import React, { useState } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';

interface Props {
  isOpen: boolean;
  engine: CanvasEngine | null;
  onClose: () => void;
}

export const ExportModal: React.FC<Props> = ({ isOpen, engine, onClose }) => {
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [resolution, setResolution] = useState<number>(2); // 1x, 2x, 4x
  const [exportScope, setExportScope] = useState<'view' | 'selection'>('view');

  if (!isOpen || !engine) return null;

  const selectedTiles = engine.getSelectedTiles();
  const hasSelection = selectedTiles.length > 0;

  const handleDownload = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filterTiles = exportScope === 'selection' && hasSelection ? selectedTiles : undefined;

    if (format === 'png') {
      const dataUrl = engine.renderer.exportPNG(resolution);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `infinite-canvas-${timestamp}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      const svgStr = engine.renderer.exportSVG(filterTiles);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infinite-canvas-${timestamp}.svg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    onClose();
  };

  return (
    <div
      data-testid="export-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
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
          maxWidth: 400,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          padding: 24,
          boxShadow: '0 24px 48px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🖼️</span>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1A' }}>Export Canvas</h2>
          </div>
          <button
            onClick={onClose}
            data-testid="btn-close-export"
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

        {/* Scope Selector */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Export Area:
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setExportScope('view')}
              data-testid="btn-scope-view"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 12,
                backgroundColor: exportScope === 'view' ? '#5B5BD6' : '#F3F4F6',
                color: exportScope === 'view' ? '#FFFFFF' : '#374151',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Current View
            </button>
            <button
              onClick={() => setExportScope('selection')}
              data-testid="btn-scope-selection"
              disabled={!hasSelection}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 12,
                backgroundColor: exportScope === 'selection' ? '#5B5BD6' : '#F3F4F6',
                color: exportScope === 'selection' ? '#FFFFFF' : '#374151',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: hasSelection ? 'pointer' : 'not-allowed',
                opacity: hasSelection ? 1 : 0.5,
              }}
            >
              Selected Tiles ({selectedTiles.length})
            </button>
          </div>
        </div>

        {/* Format Selector */}
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
            Format:
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setFormat('png')}
              data-testid="btn-format-png"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 12,
                backgroundColor: format === 'png' ? '#5B5BD6' : '#F3F4F6',
                color: format === 'png' ? '#FFFFFF' : '#374151',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              PNG (Raster)
            </button>
            <button
              onClick={() => setFormat('svg')}
              data-testid="btn-format-svg"
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 12,
                backgroundColor: format === 'svg' ? '#5B5BD6' : '#F3F4F6',
                color: format === 'svg' ? '#FFFFFF' : '#374151',
                border: 'none',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              SVG (Vector)
            </button>
          </div>
        </div>

        {/* Resolution Selector for PNG */}
        {format === 'png' && (
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Resolution Multiplier:
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2, 4].map((mult) => (
                <button
                  key={mult}
                  onClick={() => setResolution(mult)}
                  data-testid={`btn-res-${mult}x`}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 12,
                    backgroundColor: resolution === mult ? '#EEF2FF' : '#F3F4F6',
                    color: resolution === mult ? '#4F46E5' : '#374151',
                    border: resolution === mult ? '2px solid #6366F1' : '1px solid #E5E7EB',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {mult}x {mult === 2 ? '(HD)' : mult === 4 ? '(Ultra)' : '(Standard)'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleDownload}
          data-testid="btn-download-export"
          style={{
            marginTop: 8,
            padding: '12px 16px',
            borderRadius: 14,
            backgroundColor: '#5B5BD6',
            color: '#FFFFFF',
            border: 'none',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(91, 91, 214, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span>📥</span>
          <span>Download {format.toUpperCase()}</span>
        </button>
      </div>
    </div>
  );
};
