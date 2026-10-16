import React, { useState } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';

interface Props {
  engine: CanvasEngine | null;
  isOpen: boolean;
  tiles?: { tileX: number; tileY: number }[];
  onClose: () => void;
  onSuccess: (autoQuarantined: boolean) => void;
}

export const ReportModal: React.FC<Props> = ({ engine, isOpen, tiles: propTiles, onClose, onSuccess }) => {
  const [reason, setReason] = useState('inappropriate_content');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const tilesToReport: { tileX: number; tileY: number }[] =
    propTiles && propTiles.length > 0
      ? propTiles
      : [{ tileX: engine?.camera.tileX ?? 0, tileY: engine?.camera.tileY ?? 0 }];

  const pointX = Math.round((engine?.camera.offsetX ?? 0.5) * 65535);
  const pointY = Math.round((engine?.camera.offsetY ?? 0.5) * 65535);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tiles: tilesToReport,
          tileX: tilesToReport[0]?.tileX,
          tileY: tilesToReport[0]?.tileY,
          pointX,
          pointY,
          reason,
          note: note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      onSuccess(!!data.autoQuarantined);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="report-modal-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="report-modal"
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 20,
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.22)',
          maxWidth: 420,
          width: '100%',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1A1A1A' }}>
            🚩 Report Content
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              cursor: 'pointer',
              color: '#888',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        <div>
          <p style={{ margin: 0, fontSize: 13, color: '#666', lineHeight: 1.4 }}>
            Reporting{' '}
            <strong>
              {tilesToReport.length === 1
                ? `tile (${tilesToReport[0].tileX}, ${tilesToReport[0].tileY})`
                : `${tilesToReport.length} selected tiles`}
            </strong>
            . Our team reviews all reports. Multiple reports in this area will trigger immediate automatic quarantine.
          </p>

          {tilesToReport.length > 1 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 8,
                maxHeight: 70,
                overflowY: 'auto',
                padding: '4px 0',
              }}
            >
              {tilesToReport.map((t) => (
                <span
                  key={`${t.tileX},${t.tileY}`}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 6,
                    backgroundColor: '#FEE2E2',
                    color: '#DC2626',
                  }}
                >
                  ({t.tileX}, {t.tileY})
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#FEE2E2', color: '#DC2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 6 }}>
              Reason
            </label>
            <select
              data-testid="report-reason-select"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #D1D5DB',
                fontSize: 14,
                color: '#1A1A1A',
                backgroundColor: '#FAFAFA',
              }}
            >
              <option value="inappropriate_content">Inappropriate or Explicit Content</option>
              <option value="hate_speech">Hate Speech or Harassment</option>
              <option value="vandalism">Vandalism / Griefing</option>
              <option value="spam">Spam / Advertising</option>
              <option value="other">Other Violation</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 6 }}>
              Additional Details (Optional)
            </label>
            <textarea
              data-testid="report-notes-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe what is inappropriate..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #D1D5DB',
                fontSize: 13,
                color: '#1A1A1A',
                boxSizing: 'border-box',
                resize: 'none',
                backgroundColor: '#FAFAFA',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: '1px solid #E5E7EB',
                backgroundColor: '#FFFFFF',
                color: '#4B5563',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="submit-report-btn"
              disabled={submitting}
              style={{
                padding: '8px 18px',
                borderRadius: 10,
                border: 'none',
                backgroundColor: '#DC2626',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
