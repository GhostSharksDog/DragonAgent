import { safeStorage } from 'electron';
import type { Store } from './store';

export class Secrets {
  constructor(private store: Store) {}
  async get(id: string): Promise<string> {
    const data = this.store.secret(id); if (!data) return '';
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统密钥存储暂不可用，请稍后重试。');
    return (await safeStorage.decryptStringAsync(Buffer.from(data))).result;
  }
  async set(id: string, value: string): Promise<void> {
    if (!value.trim()) return; // Empty form fields never overwrite a configured key.
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('无法安全保存密钥。');
    this.store.setSecret(id, await safeStorage.encryptStringAsync(value.trim()));
  }
  remove(id: string) { this.store.removeSecret(id); }
}
