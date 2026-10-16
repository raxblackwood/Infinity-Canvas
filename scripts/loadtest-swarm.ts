import { WebSocket } from 'ws';
import crypto from 'crypto';
import {
  encodeClientHello,
  decodeServerWelcome,
  encodeClientSubscribe,
  encodeClientStrokeCommit,
  encodeStroke,
  decodeServerStrokeAck,
  decodeServerStrokeReject,
  WsMessageType,
  LocalPoint,
} from '../packages/shared/src/index.js';

export interface LoadTestConfig {
  serverUrl: string; // e.g. 'http://localhost:3001'
  totalClients: number; // e.g. 1000
  hotspotClients: number; // e.g. 200
  hotspotTile: { tileX: number; tileY: number }; // e.g. { tileX: 0, tileY: 0 }
  durationSec: number; // e.g. 10
  rampUpMs: number; // e.g. 3000
}

export interface LoadTestReport {
  totalClients: number;
  connectedClients: number;
  hotspotClients: number;
  spreadClients: number;
  totalCommitsSent: number;
  totalAcksReceived: number;
  totalRejectsReceived: number;
  p50AckLatencyMs: number;
  p95AckLatencyMs: number;
  avgAckLatencyMs: number;
  maxAckLatencyMs: number;
  strokesPerSec: number;
  bytesReceived: number;
  passed: boolean;
  failureReason?: string;
}

export async function runSwarmLoadTest(config: LoadTestConfig): Promise<LoadTestReport> {
  const wsUrl = config.serverUrl.replace(/^http/, 'ws') + '/ws';
  console.log(`\n🚀 Starting Swarm Load Test:`);
  console.log(`  Target: ${wsUrl}`);
  console.log(`  Total Bots: ${config.totalClients} (Spread: ${config.totalClients - config.hotspotClients}, Hotspot: ${config.hotspotClients})`);
  console.log(`  Hotspot Tile: (${config.hotspotTile.tileX}, ${config.hotspotTile.tileY})`);

  const ackLatencies: number[] = [];
  let totalCommitsSent = 0;
  let totalAcksReceived = 0;
  let totalRejectsReceived = 0;
  let totalBytesReceived = 0;
  let connectedClients = 0;

  const clients: {
    ws: WebSocket;
    userId: string;
    tileX: number;
    tileY: number;
    isHotspot: boolean;
    pendingCommits: Map<number, number>; // clientStrokeId -> startTimestamp
    strokeSeq: number;
  }[] = [];

  const startTime = Date.now();
  const connectDelay = config.rampUpMs / config.totalClients;

  // Batch connect clients
  const connectPromises: Promise<void>[] = [];

  for (let i = 0; i < config.totalClients; i++) {
    const isHotspot = i < config.hotspotClients;
    const tileX = isHotspot ? config.hotspotTile.tileX : (i % 40) - 20;
    const tileY = isHotspot ? config.hotspotTile.tileY : Math.floor(i / 40) - 10;

    const p = new Promise<void>((resolve) => {
      setTimeout(() => {
        try {
          const ws = new WebSocket(wsUrl);
          const rawToken = crypto.randomBytes(32).toString('hex');
          let userId = '';

          const clientEntry = {
            ws,
            userId: '',
            tileX,
            tileY,
            isHotspot,
            pendingCommits: new Map<number, number>(),
            strokeSeq: 1,
          };

          ws.on('open', () => {
            // Handshake with HELLO
            ws.send(encodeClientHello(rawToken, 1));
          });

          ws.on('message', (data: Buffer) => {
            const buf = new Uint8Array(data);
            totalBytesReceived += buf.length;
            if (buf.length === 0) return;

            const msgType = buf[0];
            if (msgType === WsMessageType.WELCOME) {
              const welcome = decodeServerWelcome(buf);
              userId = welcome.userId;
              clientEntry.userId = welcome.userId;
              connectedClients++;

              // Subscribe to tile
              ws.send(
                encodeClientSubscribe([
                  { tileX, tileY, sinceStrokeId: 0, live: true },
                ])
              );
              clients.push(clientEntry);
              resolve();
            } else if (msgType === WsMessageType.STROKE_ACK) {
              const ack = decodeServerStrokeAck(buf);
              totalAcksReceived++;
              const sentTime = clientEntry.pendingCommits.get(ack.clientStrokeId);
              if (sentTime) {
                const latency = Date.now() - sentTime;
                ackLatencies.push(latency);
                clientEntry.pendingCommits.delete(ack.clientStrokeId);
              }
            } else if (msgType === WsMessageType.STROKE_REJECT) {
              totalRejectsReceived++;
              const reject = decodeServerStrokeReject(buf);
              clientEntry.pendingCommits.delete(reject.clientStrokeId);
            }
          });

          ws.on('error', () => {
            resolve();
          });

          ws.on('close', () => {
            resolve();
          });
        } catch {
          resolve();
        }
      }, i * connectDelay);
    });

    connectPromises.push(p);
  }

  // Wait for connections to ramp up
  await Promise.all(connectPromises);
  console.log(`  Connected: ${connectedClients} / ${config.totalClients} clients.`);

  // Drawing phase: run for durationSec
  const testDurationMs = config.durationSec * 1000;
  const drawIntervalMs = 600; // Human drawing pace ~1.6 strokes/s
  const drawingStartTime = Date.now();

  const drawTimer = setInterval(() => {
    if (Date.now() - drawingStartTime > testDurationMs) {
      clearInterval(drawTimer);
      return;
    }

    // Pick a subset of bots to commit strokes each tick
    const botsToDraw = Math.min(clients.length, 120);
    for (let j = 0; j < botsToDraw; j++) {
      const botIdx = Math.floor(Math.random() * clients.length);
      const bot = clients[botIdx];
      if (!bot || bot.ws.readyState !== WebSocket.OPEN) continue;

      const strokeId = bot.strokeSeq++;
      const points: LocalPoint[] = [
        { x: 10000 + (strokeId % 5000), y: 10000 + (strokeId % 5000) },
        { x: 10500 + (strokeId % 5000), y: 10500 + (strokeId % 5000) },
      ];

      const strokeBytes = encodeStroke(strokeId % 16, 2, points);
      bot.pendingCommits.set(strokeId, Date.now());
      totalCommitsSent++;

      bot.ws.send(encodeClientStrokeCommit(strokeId, bot.tileX, bot.tileY, strokeBytes));
    }
  }, drawIntervalMs);

  // Wait for test duration plus drain window
  await new Promise((r) => setTimeout(r, testDurationMs + 2000));
  clearInterval(drawTimer);

  // Close all client sockets
  for (const c of clients) {
    try {
      c.ws.close();
    } catch {}
  }

  // Calculate stats
  ackLatencies.sort((a, b) => a - b);
  const p50 = ackLatencies.length > 0 ? ackLatencies[Math.floor(ackLatencies.length * 0.5)] : 0;
  const p95 = ackLatencies.length > 0 ? ackLatencies[Math.floor(ackLatencies.length * 0.95)] : 0;
  const avg = ackLatencies.length > 0 ? Math.round(ackLatencies.reduce((a, b) => a + b, 0) / ackLatencies.length) : 0;
  const max = ackLatencies.length > 0 ? ackLatencies[ackLatencies.length - 1] : 0;
  const elapsedSec = (Date.now() - drawingStartTime) / 1000;
  const strokesPerSec = Math.round((totalAcksReceived / Math.max(1, elapsedSec)) * 10) / 10;

  // Acceptance Criteria:
  // p95 ACK latency target < 500 ms (SPEC Section 14 & 15)
  // At least 90% of clients connected successfully
  const passed =
    connectedClients >= config.totalClients * 0.9 &&
    totalAcksReceived > 0 &&
    p95 <= 500;

  let failureReason: string | undefined;
  if (connectedClients < config.totalClients * 0.9) {
    failureReason = `Only ${connectedClients}/${config.totalClients} clients connected`;
  } else if (p95 > 500) {
    failureReason = `p95 ACK latency (${p95}ms) exceeded 500ms target`;
  }

  return {
    totalClients: config.totalClients,
    connectedClients,
    hotspotClients: config.hotspotClients,
    spreadClients: config.totalClients - config.hotspotClients,
    totalCommitsSent,
    totalAcksReceived,
    totalRejectsReceived,
    p50AckLatencyMs: p50,
    p95AckLatencyMs: p95,
    avgAckLatencyMs: avg,
    maxAckLatencyMs: max,
    strokesPerSec,
    bytesReceived: totalBytesReceived,
    passed,
    failureReason,
  };
}

const targetUrl = process.env.TARGET_URL || 'http://localhost:3001';
const total = parseInt(process.env.CLIENTS || '1000', 10);
const hotspot = parseInt(process.env.HOTSPOT || '200', 10);

  runSwarmLoadTest({
    serverUrl: targetUrl,
    totalClients: total,
    hotspotClients: hotspot,
    hotspotTile: { tileX: 0, tileY: 0 },
    durationSec: 10,
    rampUpMs: 4000,
  }).then((rep) => {
    console.log(`\n======================================================`);
    console.log(`📊 Swarm Load Test Report`);
    console.log(`======================================================`);
    console.log(`  Total Clients:      ${rep.totalClients}`);
    console.log(`  Connected:          ${rep.connectedClients}`);
    console.log(`  Hotspot Bots:       ${rep.hotspotClients} (Tile 0, 0)`);
    console.log(`  Spread Bots:        ${rep.spreadClients}`);
    console.log(`  Commits Sent:       ${rep.totalCommitsSent}`);
    console.log(`  ACKs Received:      ${rep.totalAcksReceived}`);
    console.log(`  Rejects:            ${rep.totalRejectsReceived}`);
    console.log(`  Strokes/sec:        ${rep.strokesPerSec}`);
    console.log(`  p50 Latency:        ${rep.p50AckLatencyMs} ms`);
    console.log(`  p95 Latency:        ${rep.p95AckLatencyMs} ms (Target: < 500 ms)`);
    console.log(`  Avg Latency:        ${rep.avgAckLatencyMs} ms`);
    console.log(`  Max Latency:        ${rep.maxAckLatencyMs} ms`);
    console.log(`  Bytes Received:     ${Math.round(rep.bytesReceived / 1024)} KB`);
    console.log(`  Result:             ${rep.passed ? '✅ PASSED' : '❌ FAILED'}`);
    if (rep.failureReason) {
      console.log(`  Reason:             ${rep.failureReason}`);
    }
    console.log(`======================================================\n`);

    if (!rep.passed) process.exit(1);
  });
