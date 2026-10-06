import { chatIdentity } from './engine.js';
import { CURRENT_VERSION } from './updates.js';

const detailKeys = new Set(['count', 'needed', 'characters', 'contextMessages', 'probability', 'roll', 'poolCount',
    'guideCount', 'expectedCharacters', 'scannedCharacters', 'eventFound', 'storeReadable', 'storeMatches', 'assembledHook', 'requestHook', 'truncated']);
const enumDetails = { generationType: ['normal', 'regenerate', 'swipe', 'continue', 'append', 'quiet', 'impersonate'],
    connectionMode: ['current', 'independent'], mainApi: ['openai', 'textgenerationwebui', 'kobold', 'koboldhorde', 'novel'] };
const normalize = text => text.replace(/\s+/g, ' ').trim();
export function inspectPrompt(payload, injection, eventContent) {
    const prompt = payload?.messages ?? payload?.prompt;
    const strings = [];
    let remaining = 2000000, truncated = false;
    const add = value => {
        if (typeof value !== 'string') return;
        if (value.length > remaining) truncated = true;
        if (remaining <= 0) return;
        strings.push(value.slice(0, remaining)); remaining -= Math.min(remaining, value.length);
    };
    if (typeof prompt === 'string') add(prompt);
    else if (Array.isArray(prompt)) {
        if (prompt.length > 2000) truncated = true;
        for (const message of prompt.slice(0, 2000)) {
        if (typeof message?.content === 'string') add(message.content);
        else if (Array.isArray(message?.content)) {
            if (message.content.length > 100) truncated = true;
            for (const part of message.content.slice(0, 100)) {
            if (part?.type === 'text') add(part.text);
            }
        }
        }
    }
    const text = normalize(strings.join('\n')), expected = normalize(injection || ''), event = normalize(eventContent || '');
    return { readable: strings.length > 0, found: !!expected && text.includes(expected),
        eventFound: !!event && text.includes(event), scannedCharacters: 2000000 - remaining, truncated };
}
export function errorCategory(error) {
    const text = String(error?.message || '');
    if (error?.name === 'AbortError' || /停止|取消/.test(text)) return '请求已取消';
    if (/超时|timeout/i.test(text)) return '副 AI 请求超时';
    if (/JSON|events|重复|有效.*事件|格式/.test(text) || error?.name === 'SyntaxError') return '副 AI 输出格式无效或事件重复';
    if (/地址|密钥|模型|连接|预设|服务|API/.test(text)) return 'API、模型或预设配置错误';
    return '发生异常；请结合当前阶段检查，原始错误内容不写入诊断日志';
}
export class Diagnostics {
    constructor(context, { now = () => new Date(), limit = 300, version = CURRENT_VERSION } = {}) {
        Object.assign(this, { context, now, limit, version });
        this.entries = []; this.scopes = new Map(); this.listeners = new Set(); this.enabled = true; this.sequence = 0; this.runs = 0;
    }
    scope(owner) {
        if (owner === undefined) { try { owner = chatIdentity(this.context()); } catch { owner = null; } }
        if (!owner) return '会话';
        if (!this.scopes.has(owner)) this.scopes.set(owner, `聊天 ${this.scopes.size + 1}`);
        return this.scopes.get(owner);
    }
    begin() { return `生成 ${++this.runs}`; }
    record(stage, status, message, details = {}, { owner, runId = '' } = {}) {
        if (!this.enabled) return;
        const safeDetails = Object.fromEntries(Object.entries(details).filter(([key, value]) =>
            (detailKeys.has(key) && (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) || (Object.hasOwn(enumDetails, key) && enumDetails[key].includes(value))));
        this.entries.push({ id: ++this.sequence, time: this.now().toISOString(), scope: this.scope(owner), run: runId,
            stage, status, message, details: safeDetails });
        if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
        this.notify();
    }
    list(currentOnly = true) { const scope = this.scope(); return this.entries.filter(row => !currentOnly || row.scope === scope || row.scope === '会话'); }
    export(currentOnly = true) { return JSON.stringify({ plugin: '导演系统-初月', version: this.version,
        exportedAt: this.now().toISOString(), recording: this.enabled, logs: this.list(currentOnly) }, null, 2); }
    clear(currentOnly = true) {
        const scope = this.scope(); this.entries = currentOnly ? this.entries.filter(row => row.scope !== scope && row.scope !== '会话') : []; this.notify();
    }
    notify() { for (const fn of this.listeners) { try { fn(); } catch { /* diagnostics never interrupt generation */ } } }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
