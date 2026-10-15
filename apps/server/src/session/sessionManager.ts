import crypto from 'crypto';
import { Storage, UserRecord } from '../db/storage.js';

export interface UserSession {
  user: UserRecord;
  token: string;
}

export class SessionManager {
  private storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Creates a new anonymous session.
   * Generates 32 cryptographically secure random bytes, hashes with SHA-256,
   * stores the hash, and returns the raw hex token to the client.
   */
  async createSession(): Promise<UserSession> {
    const rawTokenBytes = crypto.randomBytes(32);
    const token = rawTokenBytes.toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawTokenBytes).digest();

    const user = await this.storage.findOrCreateUser(tokenHash);
    return { user, token };
  }

  /**
   * Resumes a session from a raw hex token.
   */
  async resumeSession(token: string): Promise<UserSession | null> {
    const tokenBytes = Buffer.from(token, 'hex');
    if (tokenBytes.length !== 32) {
      return null;
    }
    const tokenHash = crypto.createHash('sha256').update(tokenBytes).digest();
    const user = await this.storage.getUserByTokenHash(tokenHash);
    if (!user) {
      return null;
    }
    return { user, token };
  }
}
