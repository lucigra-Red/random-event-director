export const CURRENT_VERSION = '0.1.12';
export const UPDATE_SETTINGS_KEY = 'random_event_director_updates_v1';
export const REPOSITORY_URL = 'https://github.com/lucigra-Red/random-event-director';
const SOURCES = [
    'https://raw.githubusercontent.com/lucigra-Red/random-event-director/main/manifest.json',
    'https://cdn.jsdelivr.net/gh/lucigra-Red/random-event-director@main/manifest.json',
];

function versionParts(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z.-]+)?$/.exec(value.trim());
    return match ? { numbers: match.slice(1, 4).map(Number), pre: match[4]?.split('.') || [] } : null;
}
export function newerVersion(remote, installed = CURRENT_VERSION) {
    const a = versionParts(remote), b = versionParts(installed);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i];
    if (!a.pre.length || !b.pre.length) return !a.pre.length && Boolean(b.pre.length);
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const x = a.pre[i], y = b.pre[i];
        if (x === y) continue;
        if (x === undefined || y === undefined) return x !== undefined;
        const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
        if (xn && yn) { if (Number(x) !== Number(y)) return Number(x) > Number(y); }
        else return xn !== yn ? !xn : x > y;
    }
    return false;
}

export class UpdateChecker {
    constructor({ context, changed = () => {}, fetchFn = (...args) => globalThis.fetch(...args), timeoutMs = 6000, version = CURRENT_VERSION }) {
        Object.assign(this, { context, changed, fetchFn, timeoutMs, version });
        this.state = { checking: false, checked: false, latest: '', available: false, manualError: false };
        this.checkedSession = false; this.task = null; this.controller = null; this.disposed = false;
    }
    autoEnabled() { return this.context().extensionSettings?.[UPDATE_SETTINGS_KEY]?.autoCheck !== false; }
    setAuto(enabled) {
        const ctx = this.context(); if (!ctx.extensionSettings) return;
        ctx.extensionSettings[UPDATE_SETTINGS_KEY] = { autoCheck: Boolean(enabled) };
        if (!enabled && this.task && !this.manualTask) this.controller?.abort();
        ctx.saveSettingsDebounced?.(); this.changed();
    }
    async read(url) {
        const controller = new AbortController(); this.controller = controller;
        let timer, cancel;
        const stopped = new Promise((_, reject) => {
            cancel = () => reject(new Error('检查已停止'));
            controller.signal.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(() => controller.abort(), this.timeoutMs);
        });
        try {
            const result = await Promise.race([stopped, (async () => {
                const response = await this.fetchFn(url, { method: 'GET', mode: 'cors', credentials: 'omit',
                    referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
                if (!response.ok) return '';
                const text = await response.text(); if (text.length > 10000) return '';
                const value = JSON.parse(text)?.version;
                return versionParts(value) ? value.trim() : '';
            })()]);
            return result;
        } catch { return ''; }
        finally {
            clearTimeout(timer); controller.signal.removeEventListener('abort', cancel);
            if (this.controller === controller) this.controller = null;
        }
    }
    check({ manual = false } = {}) {
        if (this.disposed) return Promise.resolve(false);
        if (this.task) return this.task;
        if (!manual && (!this.autoEnabled() || this.checkedSession)) return Promise.resolve(false);
        this.checkedSession = true;
        this.manualTask = manual;
        this.state.checking = true; this.state.manualError = false; this.changed();
        this.task = this.run(manual);
        return this.task;
    }
    async run(manual) {
        try {
            let latest = '';
            for (const source of SOURCES) {
                if (this.disposed || (!manual && !this.autoEnabled())) return false;
                latest = await this.read(source); if (latest) break;
            }
            if (this.disposed || (!manual && !this.autoEnabled())) return false;
            if (!latest) { this.state.manualError = manual; return false; }
            Object.assign(this.state, { checked: true, latest, available: newerVersion(latest, this.version), manualError: false });
            return true;
        } finally {
            this.task = null;
            if (!this.disposed) { this.state.checking = false; this.changed(); }
        }
    }
    dispose() { this.disposed = true; this.controller?.abort(); }
}
