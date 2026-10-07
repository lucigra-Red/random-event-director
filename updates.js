export const CURRENT_VERSION = '0.2.0';
export const UPDATE_SETTINGS_KEY = 'random_event_director_updates_v1';
export const REPOSITORY_URL = 'https://github.com/lucigra-Red/random-event-director';
const SOURCES = [
    'https://raw.githubusercontent.com/lucigra-Red/random-event-director/main/manifest.json',
    'https://cdn.jsdelivr.net/gh/lucigra-Red/random-event-director@main/manifest.json',
];

async function installedExtension() {
    const folder = decodeURIComponent(new URL('.', import.meta.url).pathname.split('/').filter(Boolean).at(-1));
    const { extensionTypes } = await import('../../../extensions.js');
    const type = extensionTypes?.[`third-party/${folder}`];
    if (!['local', 'global'].includes(type)) throw new Error('无法确定初月的安装位置，请在酒馆扩展管理中更新。');
    return { extensionName: folder, global: type === 'global' };
}

export class ExtensionUpdater {
    constructor({ context, changed = () => {}, fetchFn = (...args) => globalThis.fetch(...args), installation = installedExtension }) {
        Object.assign(this, { context, changed, fetchFn, installation });
        this.state = { updating: false, done: false, message: '' };
        this.task = null; this.disposed = false;
    }
    update() {
        if (this.disposed || this.state.done) return Promise.resolve(false);
        if (this.task) return this.task;
        this.state.updating = true; this.state.message = '正在更新初月，请稍候…'; this.changed();
        // Defer execution so a synchronous setup failure also clears the shared task.
        this.task = Promise.resolve().then(() => this.run());
        return this.task;
    }
    async run() {
        try {
            const ctx = this.context();
            if (!ctx.getRequestHeaders) throw new Error('此酒馆版本不支持直接更新，请在扩展管理中更新。');
            const target = await this.installation();
            const response = await this.fetchFn('/api/extensions/update', {
                method: 'POST', headers: ctx.getRequestHeaders(),
                body: JSON.stringify({ ...target, force: false }),
            });
            if (!response.ok) {
                const detail = (await response.text()).trim().slice(0, 500);
                if (response.status === 409) throw new Error('本地扩展文件有修改，无法直接更新。请在扩展管理中处理后重试。');
                if (response.status === 403) throw new Error('没有权限更新此扩展，请联系酒馆管理员。');
                if (response.status === 404) throw new Error('没有找到已安装的初月，请在酒馆扩展管理中检查安装状态。');
                throw new Error(`更新失败（HTTP ${response.status}）${detail ? `：${detail}` : '，请查看酒馆服务端日志。'}`);
            }
            const result = await response.json();
            if (typeof result?.isUpToDate !== 'boolean') throw new Error('更新服务返回了无法识别的结果，请在扩展管理中确认更新状态。');
            this.state.done = true;
            this.state.message = result.isUpToDate ? '本地扩展已是最新，请刷新页面载入。' : '初月已更新，刷新页面后生效。';
            return true;
        } catch (error) {
            this.state.message = error?.message || '更新失败，请检查网络连接或酒馆服务端日志。';
            return false;
        } finally {
            this.task = null; this.state.updating = false;
            if (!this.disposed) this.changed();
        }
    }
    dispose() { this.disposed = true; }
}

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
