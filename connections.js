export const CONNECTION_KEY = 'random_event_director_connection_v1';
export function connectionConfig(raw = {}) {
    const hasOwnConfig = ['endpoint', 'apiKey', 'model'].some(key => String(raw[key] || '').trim());
    const mode = raw.mode === 'current' || raw.mode === 'independent' ? raw.mode : (hasOwnConfig ? 'independent' : 'current');
    return { mode,
        endpoint: String(raw.endpoint || '').trim().slice(0, 2000),
        apiKey: String(raw.apiKey || '').trim().slice(0, 4000),
        model: String(raw.model || '').trim().slice(0, 200) };
}
export function apiBase(raw) {
    let url;
    try { url = new URL(raw); } catch { throw new Error('请填写完整的副 AI API 地址，例如 https://example.com/v1'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址须为 HTTP/HTTPS 地址；密钥请填写在密钥框中');
    }
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
}
export class ConnectionSettings {
    constructor({ storage, persist = () => {} }) { Object.assign(this, { storage, persist }); }
    read() { return connectionConfig(this.storage()?.[CONNECTION_KEY]); }
    save(raw) {
        const target = this.storage();
        if (!target) throw new Error('酒馆扩展设置不可用');
        const config = connectionConfig(raw);
        if (/\r|\n/.test(config.apiKey)) throw new Error('API 密钥不能包含换行');
        target[CONNECTION_KEY] = config; this.persist(); return { ...config };
    }
}
