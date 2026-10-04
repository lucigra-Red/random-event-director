import { Director, uuid } from './engine.js';
import { PresetLibrary } from './presets.js';
import { HeaderLibrary } from './headers.js';
import { ConnectionSettings } from './connections.js';
import { requestPool } from './api.js';
import { mountUI } from './ui.js';
import { Discussion } from './discussion.js';

const PROMPT_KEY = 'random_event_director_one_turn';
const INSTANCE_KEY = '__randomEventDirectorV1';

export function install(host = globalThis.SillyTavern, doc = globalThis.document) {
    if (!host?.getContext) throw new Error('随机事件导演需要标准 SillyTavern.getContext()');
    globalThis[INSTANCE_KEY]?.dispose();
    const context = () => host.getContext();
    const ctx = context(), bus = ctx.eventSource, events = ctx.eventTypes;
    if (!bus?.on || !events?.GENERATION_STARTED || !ctx.setExtensionPrompt) throw new Error('酒馆缺少生成事件或隐藏提示词接口');
    let ui;
    const presets = new PresetLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const headers = new HeaderLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const connection = new ConnectionSettings({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced() });
    const director = new Director({ context, request: (ctx, messages, settings, signal) => requestPool(ctx, messages, settings, signal, connection.read()), presets, headers, connection,
        inject: text => context().setExtensionPrompt(PROMPT_KEY, text, 1, 0, false, 0),
        persist: snapshot => snapshot.saveMetadata(), changed: () => ui?.refresh(),
        log: (...args) => console.warn(...args) });
    new Discussion(director);
    const bindings = [];
    function listen(name, fn) {
        if (!events[name]) return;
        const guarded = (...args) => {
            try { const result = fn(...args); if (result?.catch) result.catch(e => director.fail(e)); }
            catch (e) { director.clear(); director.fail(e); }
        };
        bus.on(events[name], guarded); bindings.push([events[name], guarded]);
    }
    const interceptor = (_chat, _size, _abort, type) => {
        // Synchronous, bounded work only. Never wait for the secondary AI or abort the host.
        try { director.intercept(type); } catch (e) { director.clear(); director.fail(e); }
    };
    globalThis.randomEventDirectorInterceptor = interceptor;
    const refreshUI = () => { if (!ui) ui = mountUI(director, context, doc); ui?.refresh(); };
    listen('APP_READY', refreshUI);
    listen('CHAT_CHANGED', () => { director.switchChat(); refreshUI(); });
    listen('CHAT_LOADED', () => { director.switchChat(); refreshUI(); });
    listen('GENERATION_STARTED', (...args) => { director.start(...args); ui?.refresh(); });
    listen('GENERATION_STOPPED', () => { director.stop(); ui?.refresh(); });
    listen('GENERATION_ENDED', () => { director.end(); ui?.refresh(); });
    listen('MESSAGE_RECEIVED', (...args) => director.receive(...args));
    listen('MESSAGE_EDITED', id => director.invalidate('edit', id));
    listen('MESSAGE_DELETED', id => director.invalidate('delete', id));
    listen('MESSAGE_SWIPED', id => director.invalidate('swipe', id));
    listen('MESSAGE_SWIPE_DELETED', id => director.invalidate('swipe', id));
    refreshUI();
    function dispose() {
        director.dispose(); ui?.dispose();
        for (const [name, handler] of bindings) bus.removeListener(name, handler);
        if (globalThis.randomEventDirectorInterceptor === interceptor) delete globalThis.randomEventDirectorInterceptor;
        globalThis.removeEventListener?.('pagehide', dispose);
        if (globalThis[INSTANCE_KEY]?.director === director) delete globalThis[INSTANCE_KEY];
    }
    globalThis.addEventListener?.('pagehide', dispose, { once: true });
    const instance = { director, dispose }; globalThis[INSTANCE_KEY] = instance;
    return instance;
}

if (globalThis.SillyTavern?.getContext && globalThis.document) {
    try { install(); } catch (e) { console.error('[随机事件导演] 加载失败；普通聊天不受影响', e); }
}
