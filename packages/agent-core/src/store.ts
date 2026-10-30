import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentRecord, SessionStore } from './types.js';
export class MemorySessionStore implements SessionStore {
  protected agents = new Map<string, AgentRecord>(); protected events: AgentEvent[] = []; private attachments = new Map<string, string>();
  async getAgent(id: string) { return structuredClone(this.agents.get(id)); }
  async putAgent(agent: AgentRecord) { this.agents.set(agent.id, structuredClone(agent)); }
  async listAgents(sessionId: string) { return structuredClone([...this.agents.values()].filter(a => a.sessionId === sessionId)); }
  async append(event: AgentEvent) { this.events.push(structuredClone({ ...event, seq: this.events.length + 1 })); }
  async history(sessionId: string) { return structuredClone(this.events.filter(e => e.sessionId === sessionId)); }
  async putAttachment(sessionId: string, text: string) { const id = randomUUID(); this.attachments.set(`${sessionId}:${id}`, text); return id; }
  async readAttachment(sessionId: string, id: string, offset: number, limit: number) { const value = this.attachments.get(`${sessionId}:${id}`); if (value === undefined) throw new Error('附件不存在或不属于此会话。'); return value.slice(offset, offset + limit); }
}
