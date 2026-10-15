import React, { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminDashboard: React.FC<Props> = ({ isOpen, onClose }) => {
  const [token, setToken] = useState<string>(() => localStorage.getItem('admin_token') || 'admin-secret-token');
  const [activeTab, setActiveTab] = useState<'queue' | 'bulk' | 'users' | 'audit' | 'stats'>('queue');
  const [reviewItems, setReviewItems] = useState<any[]>([]);
  const [auditActions, setAuditActions] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [readOnly, setReadOnly] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Bulk form state
  const [bulkTileX, setBulkTileX] = useState('');
  const [bulkTileY, setBulkTileY] = useState('');
  const [bulkMinTx, setBulkMinTx] = useState('');
  const [bulkMinTy, setBulkMinTy] = useState('');
  const [bulkMaxTx, setBulkMaxTx] = useState('');
  const [bulkMaxTy, setBulkMaxTy] = useState('');
  const [bulkUserId, setBulkUserId] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk moderation action');

  // User ban form state
  const [banUserId, setBanUserId] = useState('');
  const [banReason, setBanReason] = useState('Terms of Service violation');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const showNotice = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  };

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await fetch('/admin/api/review-queue', { headers });
      if (res.ok) {
        const data = await res.json();
        setReviewItems(data.items || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const fetchActions = async () => {
    try {
      setLoading(true);
      const res = await fetch('/admin/api/actions', { headers });
      if (res.ok) {
        const data = await res.json();
        setAuditActions(data.actions || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const fetchStatsAndKillSwitch = async () => {
    try {
      const [statsRes, ksRes] = await Promise.all([
        fetch('/admin/api/stats', { headers }),
        fetch('/admin/api/kill-switch'),
      ]);
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.stats);
      }
      if (ksRes.ok) {
        const data = await ksRes.json();
        setReadOnly(!!data.readOnly);
      }
    } catch {}
  };

  useEffect(() => {
    if (!isOpen) return;
    localStorage.setItem('admin_token', token);
    if (activeTab === 'queue') fetchQueue();
    else if (activeTab === 'audit') fetchActions();
    else if (activeTab === 'stats') fetchStatsAndKillSwitch();
  }, [isOpen, activeTab, token]);

  const handleQueueAction = async (itemId: number, action: 'restore' | 'hide' | 'ban_user') => {
    try {
      const res = await fetch(`/admin/api/review/${itemId}/action`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, reason: `Actioned by admin: ${action}` }),
      });
      if (res.ok) {
        showNotice(`Item #${itemId} actioned (${action})`);
        fetchQueue();
      } else {
        showNotice(`Failed to action item #${itemId}`);
      }
    } catch {
      showNotice('Network error');
    }
  };

  const handleBulkHide = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body: any = { reason: bulkReason };
      if (bulkUserId.trim()) body.userId = bulkUserId.trim();
      if (bulkTileX !== '') body.tileX = parseInt(bulkTileX, 10);
      if (bulkTileY !== '') body.tileY = parseInt(bulkTileY, 10);
      if (bulkMinTx !== '') body.minTx = parseInt(bulkMinTx, 10);
      if (bulkMinTy !== '') body.minTy = parseInt(bulkMinTy, 10);
      if (bulkMaxTx !== '') body.maxTx = parseInt(bulkMaxTx, 10);
      if (bulkMaxTy !== '') body.maxTy = parseInt(bulkMaxTy, 10);

      const res = await fetch('/admin/api/bulk-action', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        showNotice(`Bulk hide executed: ${data.strokeCount} strokes hidden across ${data.affectedTiles.length} tiles`);
      } else {
        showNotice('Bulk hide failed');
      }
    } catch {
      showNotice('Network error');
    }
  };

  const handleUserBan = async (banned: boolean) => {
    if (!banUserId.trim()) {
      showNotice('Please enter a User ID');
      return;
    }
    try {
      const res = await fetch(`/admin/api/users/${encodeURIComponent(banUserId.trim())}/ban`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ banned, reason: banReason }),
      });
      if (res.ok) {
        showNotice(`User ${banUserId} ${banned ? 'banned' : 'unbanned'}`);
      } else {
        showNotice('Failed to update ban status');
      }
    } catch {
      showNotice('Network error');
    }
  };

  const toggleKillSwitch = async () => {
    try {
      const next = !readOnly;
      const res = await fetch('/admin/api/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readOnly: next }),
      });
      if (res.ok) {
        const data = await res.json();
        setReadOnly(!!data.readOnly);
        showNotice(`Read-Only Kill Switch is now ${data.readOnly ? 'ACTIVE' : 'OFF'}`);
      }
    } catch {
      showNotice('Failed to toggle kill switch');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="admin-dashboard-backdrop"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 600,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="admin-dashboard-modal"
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 24,
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
          width: '100%',
          maxWidth: 850,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#F9FAFB',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 22 }}>🛡️</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
                Infinite Canvas Admin & Moderation
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>
                Inspect review queue, manage bans, bulk-moderate regions, and audit actions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              color: '#9CA3AF',
            }}
          >
            ✕
          </button>
        </div>

        {/* Token Banner */}
        <div
          style={{
            padding: '8px 24px',
            backgroundColor: '#F3F4F6',
            borderBottom: '1px solid #E5E7EB',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
          }}
        >
          <span style={{ fontWeight: 600, color: '#374151' }}>Admin Token:</span>
          <input
            data-testid="admin-token-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid #D1D5DB',
              fontSize: 12,
              width: 220,
            }}
          />
          {message && (
            <span style={{ color: '#059669', fontWeight: 600, marginLeft: 'auto' }}>
              ✓ {message}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #E5E7EB',
            backgroundColor: '#FFFFFF',
            padding: '0 24px',
          }}
        >
          {[
            { id: 'queue', label: 'Review Queue' },
            { id: 'bulk', label: 'Bulk Hide' },
            { id: 'users', label: 'User Bans' },
            { id: 'audit', label: 'Audit Log' },
            { id: 'stats', label: 'Stats & Controls' },
          ].map((tab) => (
            <button
              key={tab.id}
              data-testid={`admin-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                padding: '12px 18px',
                border: 'none',
                background: 'none',
                fontSize: 13,
                fontWeight: 600,
                color: activeTab === tab.id ? '#5B5BD6' : '#6B7280',
                borderBottom: activeTab === tab.id ? '2px solid #5B5BD6' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {activeTab === 'queue' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                  Pending Review Items ({reviewItems.length})
                </h3>
                <button
                  onClick={fetchQueue}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #D1D5DB',
                    backgroundColor: '#FFFFFF',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <div style={{ color: '#666', fontSize: 13 }}>Loading review queue...</div>
              ) : reviewItems.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
                  🎉 Review queue is completely clean! No pending items.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {reviewItems.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`review-item-${item.id}`}
                      style={{
                        padding: 14,
                        borderRadius: 12,
                        border: '1px solid #E5E7EB',
                        backgroundColor: '#F9FAFB',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 700,
                              backgroundColor: item.priority >= 10 ? '#FEE2E2' : '#FEF3C7',
                              color: item.priority >= 10 ? '#DC2626' : '#D97706',
                            }}
                          >
                            Priority {item.priority}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            Tile ({item.tileX}, {item.tileY})
                          </span>
                          <span style={{ fontSize: 12, color: '#6B7280' }}>
                            • {item.strokeCount} strokes
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: '#374151' }}>
                          Reason: {item.flaggedReason}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleQueueAction(item.id, 'restore')}
                          data-testid={`btn-restore-${item.id}`}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: '1px solid #D1D5DB',
                            backgroundColor: '#FFFFFF',
                            color: '#059669',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handleQueueAction(item.id, 'hide')}
                          data-testid={`btn-hide-${item.id}`}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            border: 'none',
                            backgroundColor: '#DC2626',
                            color: '#FFFFFF',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Hide Permanently
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'bulk' && (
            <form onSubmit={handleBulkHide} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                Bulk Moderation & Region Scrubbing
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>
                Hides all active and quarantined strokes matching the specified bounding region, tile, or user.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Specific Tile X, Y
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      data-testid="bulk-tile-x"
                      placeholder="tileX"
                      value={bulkTileX}
                      onChange={(e) => setBulkTileX(e.target.value)}
                      style={{ width: '50%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                    />
                    <input
                      data-testid="bulk-tile-y"
                      placeholder="tileY"
                      value={bulkTileY}
                      onChange={(e) => setBulkTileY(e.target.value)}
                      style={{ width: '50%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Filter by User ID
                  </label>
                  <input
                    data-testid="bulk-user-id"
                    placeholder="User UUID"
                    value={bulkUserId}
                    onChange={(e) => setBulkUserId(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Or Bounding Tile Region (minTx, minTy to maxTx, maxTy)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    data-testid="bulk-min-tx"
                    placeholder="Min Tx"
                    value={bulkMinTx}
                    onChange={(e) => setBulkMinTx(e.target.value)}
                    style={{ width: '25%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                  />
                  <input
                    data-testid="bulk-min-ty"
                    placeholder="Min Ty"
                    value={bulkMinTy}
                    onChange={(e) => setBulkMinTy(e.target.value)}
                    style={{ width: '25%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                  />
                  <input
                    data-testid="bulk-max-tx"
                    placeholder="Max Tx"
                    value={bulkMaxTx}
                    onChange={(e) => setBulkMaxTx(e.target.value)}
                    style={{ width: '25%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                  />
                  <input
                    data-testid="bulk-max-ty"
                    placeholder="Max Ty"
                    value={bulkMaxTy}
                    onChange={(e) => setBulkMaxTy(e.target.value)}
                    style={{ width: '25%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Reason (logged to audit)
                </label>
                <input
                  data-testid="bulk-reason"
                  value={bulkReason}
                  onChange={(e) => setBulkReason(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                />
              </div>

              <div>
                <button
                  type="submit"
                  data-testid="btn-execute-bulk"
                  style={{
                    padding: '10px 20px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Execute Bulk Hide
                </button>
              </div>
            </form>
          )}

          {activeTab === 'users' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>User Management & Bans</h3>
              <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>
                Banning a user immediately prevents subsequent stroke commits and rejects incoming socket traffic.
              </p>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  User ID (UUID)
                </label>
                <input
                  data-testid="ban-user-input"
                  placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                  value={banUserId}
                  onChange={(e) => setBanUserId(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Reason
                </label>
                <input
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => handleUserBan(true)}
                  data-testid="btn-ban-user"
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Ban User
                </button>
                <button
                  onClick={() => handleUserBan(false)}
                  data-testid="btn-unban-user"
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: '1px solid #D1D5DB',
                    backgroundColor: '#FFFFFF',
                    color: '#374151',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Unban User
                </button>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                  Moderation Audit Log (mod_actions)
                </h3>
                <button
                  onClick={fetchActions}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #D1D5DB',
                    backgroundColor: '#FFFFFF',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Refresh
                </button>
              </div>

              {auditActions.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
                  No moderator actions recorded yet.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB', textAlign: 'left', color: '#4B5563' }}>
                      <th style={{ padding: '8px 10px' }}>Time</th>
                      <th style={{ padding: '8px 10px' }}>Admin</th>
                      <th style={{ padding: '8px 10px' }}>Action</th>
                      <th style={{ padding: '8px 10px' }}>Target</th>
                      <th style={{ padding: '8px 10px' }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditActions.map((act) => (
                      <tr key={act.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 10px', color: '#6B7280', fontSize: 12 }}>
                          {new Date(act.createdAt).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{act.adminUser}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 11,
                              fontWeight: 600,
                              backgroundColor: act.action.includes('ban') || act.action.includes('hide') ? '#FEE2E2' : '#ECFDF5',
                              color: act.action.includes('ban') || act.action.includes('hide') ? '#DC2626' : '#059669',
                            }}
                          >
                            {act.action}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#374151' }}>
                          {act.targetType}: {act.targetId}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#4B5563' }}>{act.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'stats' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 15, fontWeight: 600 }}>Live Canvas Stats</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { label: 'Strokes / Min', val: stats?.strokesPerMinute ?? 0 },
                    { label: 'Active Users', val: stats?.activeUsers ?? 0 },
                    { label: 'Open Reports', val: stats?.openReports ?? 0 },
                    { label: 'Queue Depth', val: stats?.reviewQueueDepth ?? 0 },
                  ].map((card, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 14,
                        borderRadius: 12,
                        backgroundColor: '#F9FAFB',
                        border: '1px solid #E5E7EB',
                      }}
                    >
                      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>{card.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{card.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: 15, fontWeight: 600 }}>Emergency Kill Switch</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: 13, color: '#6B7280' }}>
                  Setting the canvas to Read-Only mode immediately freezes incoming strokes for all users.
                </p>
                <button
                  onClick={toggleKillSwitch}
                  data-testid="admin-killswitch-toggle"
                  style={{
                    padding: '10px 20px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: readOnly ? '#059669' : '#DC2626',
                    color: '#FFFFFF',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {readOnly ? '🔓 Disable Read-Only Mode (Resume Canvas)' : '🔒 Activate Read-Only Mode (Freeze Canvas)'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
