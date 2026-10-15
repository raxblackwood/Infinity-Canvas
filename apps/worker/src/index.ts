import { createStorage, getObjectStore } from '@infinite-canvas/server';
import { BakeWorker } from './runner.js';

async function main() {
  console.log('🧑‍🍳 Starting Infinite Canvas Bake Worker...');
  const storage = await createStorage();
  const objectStore = getObjectStore();

  const worker = new BakeWorker(storage, objectStore, { pollIntervalMs: 1000 });
  worker.start();
  console.log('✅ Bake Worker started, polling for jobs.');

  const shutdown = async () => {
    console.log('🛑 Shutting down Bake Worker...');
    await worker.stop();
    await storage.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  main().catch((err) => {
    console.error('Fatal Bake Worker error:', err);
    process.exit(1);
  });
}
