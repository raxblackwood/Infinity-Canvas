import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
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

/* ──────────────────────────────────────────────────────────────────────────
   ICONS (Lucide-style: 24 grid, 1.75 stroke, round caps and joins)
   ────────────────────────────────────────────────────────────────────────── */

function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

const I = {
  Droplet: (p: IconProps) => (
    <Icon {...p}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </Icon>
  ),
  Undo: (p: IconProps) => (
    <Icon {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  ),
  Pencil: (p: IconProps) => (
    <Icon {...p}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Icon>
  ),
  Hand: (p: IconProps) => (
    <Icon {...p}>
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </Icon>
  ),
  Crosshair: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M22 12h-4" />
      <path d="M6 12H2" />
      <path d="M12 6V2" />
      <path d="M12 22v-4" />
      <circle cx="12" cy="12" r="1" />
    </Icon>
  ),
  Info: (p: IconProps) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Icon>
  ),
  Shield: (p: IconProps) => (
    <Icon {...p}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  ),
  Map: (p: IconProps) => (
    <Icon {...p}>
      <path d="M14.1 5.55a2 2 0 0 0 1.79 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.89l-4.55 2.28a2 2 0 0 1-1.79 0l-4.21-2.1a2 2 0 0 0-1.79 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.89l4.55-2.28a2 2 0 0 1 1.79 0z" />
      <path d="M15 5.76v15" />
      <path d="M9 3.24v15" />
    </Icon>
  ),
  Download: (p: IconProps) => (
    <Icon {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Icon>
  ),
  Link: (p: IconProps) => (
    <Icon {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  ),
  Flag: (p: IconProps) => (
    <Icon {...p}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </Icon>
  ),
  Lock: (p: IconProps) => (
    <Icon {...p}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Icon>
  ),
};

/* ──────────────────────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────────────────────── */

interface Swatch {
  hex: string;
  name: string;
}

function toSwatch(entry: unknown, i: number): Swatch {
  if (typeof entry === 'string') return { hex: entry, name: `Color ${i + 1}` };
  const o = (entry ?? {}) as { hex?: string; color?: string; name?: string };
  return { hex: o.hex ?? o.color ?? '#1A1A1A', name: o.name ?? `Color ${i + 1}` };
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.85;
}

function dotSize(i: number, n: number, min = 4, max = 18): number {
  return Math.round(min + (n > 1 ? i / (n - 1) : 0) * (max - min));
}

const stop = (e: ReactPointerEvent) => e.stopPropagation();

/* ──────────────────────────────────────────────────────────────────────────
   PILL BUTTON COMPONENT
   ────────────────────────────────────────────────────────────────────────── */

function Pill({
  testId,
  icon,
  label,
  onClick,
  tone,
  active,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: 'accent';
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className="ic-btn ic-pill"
      data-testid={testId}
      data-tone={tone}
      data-active={active ? 'true' : undefined}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      onClick={onClick}
    >
      {icon}
      <span className="ic-pill-label">{label}</span>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   MAIN TOOLBAR COMPONENT
   ────────────────────────────────────────────────────────────────────────── */

export const Toolbar: React.FC<Props> = ({
  engine,
  isReportSelecting = false,
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
  const [open, setOpen] = useState<'color' | 'size' | null>(null);
  const [ink, setInk] = useState(() => engine?.network?.currentInk ?? 100);
  const [toast, setToast] = useState<string | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(() => Boolean(engine?.network?.welcomeInfo?.readOnly));
  const dockRef = useRef<HTMLDivElement>(null);

  const swatches = useMemo(() => (PALETTE as readonly unknown[]).map(toSwatch), []);
  const widths = BRUSH_WIDTHS as readonly number[];

  const activeColor = swatches[selectedColor] ?? swatches[0];
  const activeRing = isLight(activeColor.hex) ? 'var(--ic-sep)' : activeColor.hex;

  const inkLevel = ink < 8 ? 'empty' : ink < 20 ? 'low' : 'ok';

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

  // Dismiss popovers on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showToastNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const togglePop = useCallback((which: 'color' | 'size') => {
    setOpen((cur) => (cur === which ? null : which));
  }, []);

  const handlePickColor = (idx: number) => {
    setSelectedColor(idx);
    engine?.setColor(idx);
    setOpen(null);
  };

  const handlePickWidth = (idx: number) => {
    setSelectedWidth(idx);
    engine?.setWidth(idx);
    setOpen(null);
  };

  const handleSetMode = (nextMode: InteractionMode) => {
    setMode(nextMode);
    engine?.setMode(nextMode);
  };

  const handleResetOrigin = () => {
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
    <div className="ic-root">
      <style>{CSS}</style>

      {/* Read-Only Status Banner */}
      {isReadOnly && (
        <div className="ic-banner" data-testid="readonly-banner" role="status">
          <I.Lock size={15} />
          <span>Read-only mode. Drawing is paused.</span>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="ic-toast" data-testid="toast-notification" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {/* Top-Left Header: Rules & Admin */}
      <div className="ic-top ic-top-left" onPointerDown={stop}>
        <div className="ic-glass ic-pillbar">
          {onOpenInfo && (
            <Pill testId="btn-info" icon={<I.Info size={17} />} label="Rules" onClick={onOpenInfo} />
          )}
          {onOpenAdmin && (
            <Pill testId="btn-admin" tone="accent" icon={<I.Shield size={17} />} label="Admin" onClick={onOpenAdmin} />
          )}
        </div>
      </div>

      {/* Top-Right Header: Map, Export, Share, Report */}
      <div className="ic-top ic-top-right" onPointerDown={stop}>
        <div className="ic-glass ic-pillbar">
          {onOpenMap && (
            <Pill testId="btn-map" icon={<I.Map size={17} />} label="Map" onClick={onOpenMap} />
          )}
          {onOpenExport && (
            <Pill testId="btn-export" icon={<I.Download size={17} />} label="Export" onClick={onOpenExport} />
          )}
          <Pill testId="btn-share" icon={<I.Link size={17} />} label="Share" onClick={handleShare} />
          {onOpenReport && (
            <Pill
              testId="btn-report"
              icon={<I.Flag size={17} />}
              label={isReportSelecting ? 'Selecting...' : 'Report'}
              active={isReportSelecting}
              onClick={onOpenReport}
            />
          )}
        </div>
      </div>

      {/* Bottom Floating Dock */}
      <div className="ic-dock-wrap" ref={dockRef} onPointerDown={stop}>
        <div className="ic-glass ic-dock" role="toolbar" aria-label="Drawing tools">
          {/* Ink Meter */}
          <div
            className="ic-ink"
            data-testid="ink-meter"
            data-level={inkLevel}
            role="status"
            aria-label={`Ink ${ink} percent`}
            title={`Ink: ${ink}/100 tokens`}
          >
            <I.Droplet size={14} />
            <span className="ic-ink-value">{ink}</span>
          </div>

          {/* Undo */}
          <button
            type="button"
            className="ic-btn"
            data-testid="btn-undo"
            aria-label="Undo last stroke"
            title="Undo last stroke (within 30s)"
            onClick={handleUndo}
          >
            <I.Undo size={18} />
          </button>

          <span className="ic-sep" aria-hidden="true" />

          {/* Color Picker Trigger & Popover */}
          <div className="ic-anchor">
            <button
              type="button"
              className="ic-btn"
              data-testid="btn-color"
              aria-label={`Color: ${activeColor.name}`}
              title="Color palette"
              aria-haspopup="true"
              aria-expanded={open === 'color'}
              onClick={() => togglePop('color')}
            >
              <span
                className="ic-dot-color"
                style={{ background: activeColor.hex, ['--ic-ring' as string]: activeRing }}
              />
            </button>

            {open === 'color' && (
              <div className="ic-popover" role="dialog" aria-label="Choose color">
                <div className="ic-color-grid" role="radiogroup" aria-label="Colors">
                  {swatches.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={i === selectedColor}
                      aria-label={s.name}
                      title={s.name}
                      className="ic-swatch"
                      style={{ background: s.hex }}
                      onClick={() => handlePickColor(i)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Brush Size Trigger & Popover */}
          <div className="ic-anchor">
            <button
              type="button"
              className="ic-btn ic-btn-ring"
              data-testid="btn-size"
              aria-label="Brush size"
              title="Brush size"
              aria-haspopup="true"
              aria-expanded={open === 'size'}
              onClick={() => togglePop('size')}
            >
              <span
                className="ic-dot-size"
                style={{
                  width: dotSize(selectedWidth, widths.length),
                  height: dotSize(selectedWidth, widths.length),
                }}
              />
            </button>

            {open === 'size' && (
              <div className="ic-popover" role="dialog" aria-label="Choose brush size">
                <div className="ic-size-bar" role="radiogroup" aria-label="Brush sizes">
                  {widths.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={i === selectedWidth}
                      aria-label={`Size ${i + 1} of ${widths.length}`}
                      className="ic-size-opt"
                      onClick={() => handlePickWidth(i)}
                    >
                      <span
                        className="ic-dot-size"
                        style={{
                          width: dotSize(i, widths.length, 4, 20),
                          height: dotSize(i, widths.length, 4, 20),
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="ic-sep" aria-hidden="true" />

          {/* Segmented Mode Toggle (Draw vs Move) */}
          <div className="ic-seg" data-mode={mode === 'move' ? 'move' : 'draw'} role="group" aria-label="Tool mode">
            <span className="ic-seg-thumb" aria-hidden="true" />
            <button
              type="button"
              className="ic-seg-btn"
              data-testid="btn-mode-draw"
              aria-pressed={mode !== 'move'}
              aria-label="Draw tool"
              title="Draw tool (drag draws)"
              onClick={() => handleSetMode('draw')}
            >
              <I.Pencil size={17} />
            </button>
            <button
              type="button"
              className="ic-seg-btn"
              data-testid="btn-mode-move"
              aria-pressed={mode === 'move'}
              aria-label="Move tool"
              title="Move tool (drag pans)"
              onClick={() => handleSetMode('move')}
            >
              <I.Hand size={17} />
            </button>
          </div>

          {/* Reset View to Origin (0,0) */}
          <button
            type="button"
            className="ic-btn ic-origin"
            data-testid="btn-origin"
            aria-label="Go to origin (0,0)"
            title="Reset to center (0,0)"
            onClick={handleResetOrigin}
          >
            <I.Crosshair size={16} />
            <span className="ic-badge">(0,0)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;

/* ──────────────────────────────────────────────────────────────────────────
   STYLES (Apple / Linear-grade frosted glass, scoped with .ic- prefix)
   ────────────────────────────────────────────────────────────────────────── */

const CSS = `
.ic-root{
  --ic-glass:rgba(255,255,255,.90);
  --ic-solid:rgba(255,255,255,.98);
  --ic-border:rgba(0,0,0,.08);
  --ic-fg:#1a1a1a;
  --ic-muted:rgba(26,26,26,.58);
  --ic-hover:rgba(0,0,0,.05);
  --ic-track:rgba(0,0,0,.06);
  --ic-sep:rgba(0,0,0,.1);
  --ic-gap:#fff;
  --ic-accent:#5b5bd6;
  --ic-accent-soft:rgba(91,91,214,.12);
  --ic-danger:#e5484d;
  --ic-warn:#c26a00;
  --ic-shadow:0 8px 30px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);
  --ic-ease:cubic-bezier(.16,1,.3,1);
  display:contents;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;
}
@media (prefers-color-scheme:dark){
  .ic-root{
    --ic-glass:rgba(30,30,34,.90);
    --ic-solid:rgba(36,36,41,.98);
    --ic-border:rgba(255,255,255,.12);
    --ic-fg:#f2f2f2;
    --ic-muted:rgba(242,242,242,.6);
    --ic-hover:rgba(255,255,255,.08);
    --ic-track:rgba(255,255,255,.10);
    --ic-sep:rgba(255,255,255,.15);
    --ic-gap:#26262b;
    --ic-accent:#8b8bf5;
    --ic-accent-soft:rgba(139,139,245,.2);
    --ic-warn:#f5a524;
    --ic-shadow:0 8px 30px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.3);
  }
}

.ic-glass{
  background:var(--ic-glass);
  -webkit-backdrop-filter:blur(20px) saturate(1.4);
  backdrop-filter:blur(20px) saturate(1.4);
  border:1px solid var(--ic-border);
  box-shadow:var(--ic-shadow);
}

/* shared button base */
.ic-btn{
  appearance:none;border:0;background:transparent;color:var(--ic-fg);
  height:36px;min-width:36px;padding:0;border-radius:999px;
  display:inline-flex;align-items:center;justify-content:center;gap:6px;
  font:inherit;cursor:pointer;
  transition:all 120ms var(--ic-ease);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
@media (hover:hover){.ic-btn:hover{background:var(--ic-hover)}}
.ic-btn:active{transform:scale(.95)}
.ic-btn:focus-visible,.ic-seg-btn:focus-visible,.ic-swatch:focus-visible,.ic-size-opt:focus-visible{outline:2px solid var(--ic-accent);outline-offset:2px}
.ic-btn[aria-expanded="true"]{background:var(--ic-hover)}
.ic-btn-ring{box-shadow:inset 0 0 0 1.5px var(--ic-sep)}

/* top pills */
.ic-top{position:fixed;top:calc(12px + env(safe-area-inset-top,0px));z-index:50}
.ic-top-left{left:calc(12px + env(safe-area-inset-left,0px))}
.ic-top-right{right:calc(12px + env(safe-area-inset-right,0px))}
.ic-pillbar{display:flex;align-items:center;gap:3px;padding:4px;border-radius:999px}
.ic-pill{height:34px;padding:0 12px 0 10px;font-size:13px;font-weight:550;letter-spacing:-.005em;color:var(--ic-fg)}
.ic-pill[data-tone="accent"]{color:var(--ic-accent)}
.ic-pill[data-active="true"]{background:rgba(229,72,77,.14);color:var(--ic-danger)}
.ic-pill-label{white-space:nowrap}
@media (max-width:639px){
  .ic-pill{width:34px;min-width:34px;padding:0}
  .ic-pill-label{display:none}
}

/* bottom dock */
.ic-dock-wrap{
  position:fixed;left:50%;transform:translateX(-50%);
  bottom:calc(20px + env(safe-area-inset-bottom,0px));
  z-index:50;max-width:calc(100vw - 16px);
}
.ic-dock{
  display:flex;align-items:center;gap:4px;padding:6px;border-radius:999px;
  color:var(--ic-fg);user-select:none;-webkit-user-select:none;
}
.ic-sep{width:1px;height:20px;background:var(--ic-sep);margin:0 3px;flex:none}
.ic-anchor{position:relative;display:inline-flex}

/* ink meter */
.ic-ink{
  display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px 0 9px;
  border-radius:999px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;
  color:var(--ic-accent);background:var(--ic-accent-soft);
  transition:all 200ms var(--ic-ease);
}
.ic-ink-value::after{content:"%";font-size:11px;font-weight:500;opacity:.65;margin-left:1px}
.ic-ink[data-level="low"]{
  color:var(--ic-warn);background:rgba(245,158,11,.16);
  box-shadow:0 0 0 3px rgba(245,158,11,.12),0 0 14px rgba(245,158,11,.35);
}
.ic-ink[data-level="empty"]{
  color:var(--ic-danger);background:rgba(229,72,77,.14);
  box-shadow:0 0 0 3px rgba(229,72,77,.12),0 0 14px rgba(229,72,77,.4);
  animation:ic-pulse 1.6s ease-in-out infinite;
}
@keyframes ic-pulse{50%{box-shadow:0 0 0 3px rgba(229,72,77,.06),0 0 6px rgba(229,72,77,.2)}}

/* triggers */
.ic-dot-color{
  width:20px;height:20px;border-radius:50%;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.14),0 0 0 2px var(--ic-gap),0 0 0 3.5px var(--ic-ring,var(--ic-sep));
  transition:all 120ms var(--ic-ease);
}
.ic-dot-size{display:block;border-radius:50%;background:var(--ic-fg);transition:all 120ms var(--ic-ease)}

/* segmented mode toggle */
.ic-seg{position:relative;display:inline-flex;padding:2px;border-radius:999px;background:var(--ic-track)}
.ic-seg-thumb{
  position:absolute;top:2px;left:2px;width:34px;height:32px;border-radius:999px;
  background:var(--ic-accent);box-shadow:0 1px 3px rgba(91,91,214,.4);
  transition:transform 160ms var(--ic-ease);
}
.ic-seg[data-mode="move"] .ic-seg-thumb{transform:translateX(34px)}
.ic-seg-btn{
  position:relative;z-index:1;width:34px;height:32px;padding:0;border:0;border-radius:999px;
  background:transparent;color:var(--ic-muted);cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;
  transition:all 120ms var(--ic-ease);touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
.ic-seg-btn:active{transform:scale(.95)}
.ic-seg-btn[aria-pressed="true"]{color:#fff}
@media (hover:hover){.ic-seg-btn[aria-pressed="false"]:hover{color:var(--ic-fg)}}

/* origin */
.ic-origin{padding:0 8px 0 7px;gap:5px}
.ic-badge{
  font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ic-muted);
  background:var(--ic-track);padding:2px 5px;border-radius:999px;
}

/* popovers */
.ic-popover{
  position:absolute;left:50%;bottom:calc(100% + 14px);transform:translateX(-50%);
  padding:12px;border-radius:20px;background:var(--ic-solid);
  border:1px solid var(--ic-border);box-shadow:var(--ic-shadow);
  -webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);
  transform-origin:50% 100%;animation:ic-pop 160ms var(--ic-ease);
  z-index:100;
}
@keyframes ic-pop{
  from{opacity:0;transform:translateX(-50%) translateY(6px) scale(.97)}
  to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
}
.ic-color-grid{display:grid;grid-template-columns:repeat(4,28px);gap:8px}
.ic-swatch{
  width:28px;height:28px;padding:0;border:0;border-radius:50%;cursor:pointer;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.14);
  transition:all 120ms var(--ic-ease);touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
@media (hover:hover){.ic-swatch:hover{transform:scale(1.1)}}
.ic-swatch:active{transform:scale(.95)}
.ic-swatch[aria-checked="true"]{
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.14),0 0 0 2px var(--ic-solid),0 0 0 4px var(--ic-accent);
}
.ic-size-bar{display:flex;align-items:center;gap:2px}
.ic-size-opt{
  width:38px;height:38px;padding:0;border:0;border-radius:50%;background:transparent;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;color:var(--ic-fg);
  transition:all 120ms var(--ic-ease);touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
@media (hover:hover){.ic-size-opt:hover{background:var(--ic-hover)}}
.ic-size-opt:active{transform:scale(.95)}
.ic-size-opt[aria-checked="true"]{background:var(--ic-accent-soft);box-shadow:inset 0 0 0 1.5px var(--ic-accent)}

/* toast and banner */
.ic-toast{
  position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);
  z-index:60;max-width:calc(100vw - 32px);padding:10px 18px;border-radius:999px;
  background:rgba(24,24,27,.94);color:#fff;font-size:13px;font-weight:500;text-align:center;
  box-shadow:var(--ic-shadow);animation:ic-toast-in 220ms var(--ic-ease);
}
@keyframes ic-toast-in{
  from{opacity:0;transform:translateX(-50%) translateY(8px)}
  to{opacity:1;transform:translateX(-50%) translateY(0)}
}
.ic-banner{
  position:fixed;left:50%;top:calc(58px + env(safe-area-inset-top,0px));transform:translateX(-50%);
  z-index:50;display:inline-flex;align-items:center;gap:8px;max-width:calc(100vw - 32px);
  padding:8px 14px;border-radius:999px;font-size:13px;font-weight:500;color:var(--ic-warn);
  background:var(--ic-glass);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);
  border:1px solid var(--ic-border);box-shadow:var(--ic-shadow);
}

/* narrow phones */
@media (max-width:420px){
  .ic-dock{gap:2px;padding:5px}
  .ic-sep{margin:0 2px}
}
@media (max-width:379px){.ic-origin .ic-badge{display:none}.ic-origin{padding:0}}

@media (prefers-reduced-motion:reduce){
  .ic-root *{transition:none!important;animation:none!important}
}
`;
