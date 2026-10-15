import React, { useState } from 'react';
import { PALETTE, BRUSH_WIDTHS } from '@infinite-canvas/shared';
import { CanvasEngine } from '../engine/CanvasEngine.js';
import { InteractionMode } from '../engine/PointerCapture.js';

interface Props {
  engine: CanvasEngine | null;
}

export const Toolbar: React.FC<Props> = ({ engine }) => {
  const [mode, setMode] = useState<InteractionMode>('draw');
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedWidth, setSelectedWidth] = useState(2); // default 256 units
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);

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

  return (
    <>
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
            gap: 14,
            zIndex: 100,
          }}
        >
          {BRUSH_WIDTHS.map((widthUnits, idx) => {
            // Relative dot visual size: 6px to 26px
            const dotSize = 6 + idx * 4;
            return (
              <button
                key={widthUnits}
                onClick={() => selectWidth(idx)}
                title={`Brush size ${idx + 1} (${widthUnits} units)`}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
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
                    width: dotSize,
                    height: dotSize,
                    borderRadius: '50%',
                    backgroundColor: PALETTE[selectedColor]?.hex || '#1A1A1A',
                  }}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Main Bottom Toolbar */}
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(76px + env(safe-area-inset-bottom, 0px))',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(16px)',
          borderRadius: 24,
          padding: '6px 14px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
          border: '1px solid rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 90,
        }}
      >
        {/* Color Button */}
        <button
          onClick={() => {
            setShowColorPicker(!showColorPicker);
            setShowSizePicker(false);
          }}
          title="Choose Color"
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            backgroundColor: PALETTE[selectedColor]?.hex || '#1A1A1A',
            border: '2px solid #FFFFFF',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
            cursor: 'pointer',
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
            width: 34,
            height: 34,
            borderRadius: '50%',
            backgroundColor: '#F4F4F6',
            border: '1px solid rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 6 + selectedWidth * 3,
              height: 6 + selectedWidth * 3,
              borderRadius: '50%',
              backgroundColor: '#1A1A1A',
            }}
          />
        </button>

        <div style={{ width: 1, height: 24, backgroundColor: '#E0E0E0' }} />

        {/* Draw / Move Toggle */}
        <button
          onClick={toggleMode}
          style={{
            padding: '6px 12px',
            borderRadius: 14,
            backgroundColor: mode === 'draw' ? '#5B5BD6' : '#F0F0F5',
            color: mode === 'draw' ? '#FFFFFF' : '#1A1A1A',
            border: 'none',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {mode === 'draw' ? '✏️ Draw' : '✋ Move'}
        </button>

        {/* Reset View */}
        <button
          onClick={resetView}
          title="Reset View to Center"
          style={{
            padding: '6px 10px',
            borderRadius: 14,
            backgroundColor: '#F0F0F5',
            color: '#1A1A1A',
            border: 'none',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          🎯 (0,0)
        </button>
      </div>
    </>
  );
};
