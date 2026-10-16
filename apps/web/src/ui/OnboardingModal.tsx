import React, { useState } from 'react';
import { CanvasEngine } from '../engine/CanvasEngine.js';

interface Props {
  isOpen: boolean;
  engine: CanvasEngine | null;
  onAccept: () => void;
  onClose?: () => void;
  isFirstRun?: boolean;
}

export const OnboardingModal: React.FC<Props> = ({
  isOpen,
  engine,
  onAccept,
  onClose,
  isFirstRun = false,
}) => {
  const [currentCard, setCurrentCard] = useState(0);

  if (!isOpen) return null;

  const cards = [
    {
      icon: '🌌',
      title: 'Infinite Shared Canvas',
      desc: 'An unbounded canvas shared in realtime across the world. Zoom in for micro-details or zoom out for a world overview — strokes stay razor-sharp at every scale.',
    },
    {
      icon: '✏️',
      title: 'Gestures & Drawing',
      desc: 'Draw using one finger (or mouse left-click). Pan with two fingers (or Space + drag / middle mouse). Pinch or use the scroll wheel to zoom seamlessly.',
    },
    {
      icon: '📜',
      title: 'Community Rules',
      desc: 'No sexual content, hate speech, graphic violence, harassment, personal information, advertising or spam. Moderators may remove anything. Reports are anonymous.',
    },
  ];

  const handleAccept = async () => {
    localStorage.setItem('rules_accepted_v1', 'true');
    if (engine) {
      engine.setDrawingEnabled(true);
      const token = engine.network?.token;
      if (token) {
        try {
          await fetch('/api/rules/accept', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ rulesVersion: 1 }),
          });
        } catch (e) {
          console.warn('Failed to send rules acceptance to server:', e);
        }
      }
    }
    onAccept();
  };

  return (
    <div
      data-testid="onboarding-modal"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        padding: 16,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          padding: '28px 24px 24px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        {!isFirstRun && onClose && (
          <button
            onClick={onClose}
            data-testid="btn-close-onboarding"
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
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
        )}

        {/* Card Icon */}
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {cards[currentCard].icon}
        </div>

        {/* Card Title */}
        <h2
          data-testid="onboarding-title"
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: '#1A1A1A',
            marginBottom: 10,
          }}
        >
          {cards[currentCard].title}
        </h2>

        {/* Card Body */}
        <p
          data-testid="onboarding-desc"
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            color: '#555555',
            marginBottom: 24,
            minHeight: 64,
          }}
        >
          {cards[currentCard].desc}
        </p>

        {/* Dots Indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {cards.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentCard(idx)}
              data-testid={`onboarding-dot-${idx}`}
              style={{
                width: currentCard === idx ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: currentCard === idx ? '#5B5BD6' : '#E0E0E0',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', width: '100%', gap: 10 }}>
          {currentCard > 0 && (
            <button
              onClick={() => setCurrentCard((c) => c - 1)}
              data-testid="btn-onboarding-prev"
              style={{
                flex: 1,
                padding: '12px 16px',
                borderRadius: 14,
                backgroundColor: '#F0F0F5',
                color: '#1A1A1A',
                border: 'none',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          )}

          {currentCard < cards.length - 1 ? (
            <button
              onClick={() => setCurrentCard((c) => c + 1)}
              data-testid="btn-onboarding-next"
              style={{
                flex: 2,
                padding: '12px 16px',
                borderRadius: 14,
                backgroundColor: '#5B5BD6',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleAccept}
              data-testid="btn-accept-rules"
              style={{
                flex: 2,
                padding: '12px 16px',
                borderRadius: 14,
                backgroundColor: '#5B5BD6',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(91, 91, 214, 0.35)',
              }}
            >
              Accept & Start Drawing
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
