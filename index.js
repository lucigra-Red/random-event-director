import { Director, uuid } from './engine.js';
import { PresetLibrary } from './presets.js';
import { HeaderLibrary } from './headers.js';
import { ConnectionSettings } from './connections.js';
import { requestPool } from './api.js';
import { mountUI } from './ui.js';
import { Discussion } from './discussion.js';
import { Diagnostics, inspectPrompt, errorCategory } from './diagnostics.js';

const PROMPT_KEY = 'random_event_director_one_turn';
const INSTANCE_KEY = '__randomEventDirectorV1';

export function install(host = globalThis.SillyTavern, doc = globalThis.document) {
    if (!host?.getContext) throw new Error('随机事件导演需要标准 SillyTavern.getContext()');
    globalThis[INSTANCE_KEY]?.dispose();
    const context = () => host.getContext();
    const ctx = context(), bus = ctx.eventSource, events = ctx.eventTypes;
    if (!bus?.on || !events?.GENERATION_STARTED || !ctx.setExtensionPrompt) throw new Error('酒馆缺少生成事件或隐藏提示词接口');
    let ui, injectionActive = false;
    const diagnostics = new Diagnostics(context);
    const presets = new PresetLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const headers = new HeaderLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const connection = new ConnectionSettings({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced() });
    const director = new Director({ context, request: (ctx, messages, settings, signal) => {
        const config = connection.read();
        director.trace('副 AI 连接', 'info', '使用当前副 AI 连接发送请求；请求内容和凭据不写入日志。', { connectionMode: config.mode }, undefined, '');
        return requestPool(ctx, messages, settings, signal, config);
    }, presets, headers, connection, diagnostics,
        inject: text => {
            const current = context(), wasActive = injectionActive;
            try { current.setExtensionPrompt(PROMPT_KEY, text, 1, 0, false, 0); }
            catch (e) { director.trace(text ? '写入扩展提示词' : '清除扩展提示词', 'error', '酒馆的 setExtensionPrompt 接口抛出异常。'); throw e; }
            injectionActive = Boolean(text);
            if (text || wasActive) {
                try {
                    const store = current.extensionPrompts, readable = !!store && typeof store === 'object';
                    const matches = readable && store[PROMPT_KEY]?.value === text;
                    director.trace(text ? '写入扩展提示词' : '清除扩展提示词', readable && !matches ? 'warn' : (readable ? 'success' : 'info'),
                        text ? (readable ? (matches ? '酒馆扩展提示词中读回了本轮注入；还需检测最终请求。' : '调用接口后读回的内容不一致，可能被覆盖或宿主接口行为不同。') : '已调用酒馆注入接口，但此版本无法读取扩展提示词存储。')
                            : '本轮临时提示词已执行清除。', { characters: text.length, storeReadable: readable, storeMatches: matches });
                } catch { director.trace('注入存储检测', 'warn', '诊断无法读回扩展提示词；注入接口调用已完成，不改动生成流程。'); }
            }
        },
        persist: snapshot => snapshot.saveMetadata(), changed: () => ui?.refresh(),
        log: (...args) => console.warn(...args) });
    new Discussion(director);
    const bindings = [];
    function listen(name, fn) {
        if (!events[name]) return;
        const guarded = (...args) => {
            try { const result = fn(...args); if (result?.catch) result.catch(e => director.fail(e)); }
            catch (e) { director.trace('宿主事件异常', 'error', errorCategory(e)); director.clear(); director.fail(e); }
        };
        bus.on(events[name], guarded); bindings.push([events[name], guarded]);
    }
    const interceptor = (_chat, _size, _abort, type) => {
        // Synchronous, bounded work only. Never wait for the secondary AI or abort the host.
        try { director.intercept(type); } catch (e) { director.trace('注入异常', 'error', errorCategory(e)); director.clear(); director.fail(e); }
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
    function observeRequest(payload, dryRun, stage) {
        if (dryRun || !director.busy || !director.run || !director.diagnosticRun?.eligible) return;
        const state = director.state(), run = director.run;
        if (!state || run.metadata !== context().chatMetadata || state.owner !== run.owner || run.stopped) return;
        const cycle = state.cycles[run.cycleKey];
        if (!run.injected || !cycle?.event) {
            director.trace(stage, director.diagnosticRun?.intercepted ? 'skip' : 'warn', director.diagnosticRun?.intercepted
                ? '本轮没有事件注入，组装的请求无需包含事件。' : '已经组装主请求，但没有收到本插件的注入回调。'); return;
        }
        const check = inspectPrompt(payload, cycle.injection, cycle.event.content);
        if (director.diagnosticRun) director.diagnosticRun.observed = check.readable || director.diagnosticRun.observed;
        director.trace(stage, !check.readable ? 'warn' : (check.found ? 'success' : (check.eventFound || check.truncated ? 'warn' : 'error')),
            !check.readable ? '此请求数据没有可读取的文本提示词，无法核对注入。'
                : check.found ? '检测到完整事件注入。此检测不代表模型已收到或一定遵循该事件。'
                    : check.truncated ? '请求过长，诊断只检测了部分文本；未检测到完整注入，无法判定丢失。'
                    : check.eventFound ? '检测到事件内容，但完整注入模板不一致；提示词可能被改写。'
                        : '已调用注入接口，但此阶段的主请求中没有检测到事件；请检查提示词组装、截断或其他扩展覆盖。',
            { expectedCharacters: cycle.injection?.length || 0, scannedCharacters: check.scannedCharacters, eventFound: check.eventFound, truncated: check.truncated });
    }
    function observeSafely(payload, dryRun, stage) {
        try { observeRequest(payload, dryRun, stage); }
        catch { director.trace(stage, 'warn', '诊断无法解析此请求数据；不清除注入，也不改动主生成流程。'); }
    }
    listen('GENERATE_AFTER_DATA', (data, dryRun) => observeSafely(data, dryRun, '主请求组装检测'));
    listen('CHAT_COMPLETION_SETTINGS_READY', data => observeSafely(data, false, 'Chat Completion 发送前检测'));
    diagnostics.record('插件加载', 'success', '诊断日志已启动。仅在当前页面内存保存，使用聊天编号，不记录角色名、密钥、请求头或完整提示词。',
        { assembledHook: !!events.GENERATE_AFTER_DATA, requestHook: !!events.CHAT_COMPLETION_SETTINGS_READY }, { owner: null });
    if (!events.GENERATE_AFTER_DATA) diagnostics.record('宿主兼容性', 'warn', '酒馆没有提供主请求组装事件；部分注入检测不可用，不能据此判定注入失败。', {}, { owner: null });
    refreshUI();
    function dispose() {
        director.dispose(); ui?.dispose();
        for (const [name, handler] of bindings) bus.removeListener(name, handler);
        if (globalThis.randomEventDirectorInterceptor === interceptor) delete globalThis.randomEventDirectorInterceptor;
        globalThis.removeEventListener?.('pagehide', dispose);
        if (globalThis[INSTANCE_KEY]?.director === director) delete globalThis[INSTANCE_KEY];
    }
    globalThis.addEventListener?.('pagehide', dispose, { once: true });
    const instance = { director, diagnostics, dispose }; globalThis[INSTANCE_KEY] = instance;
    return instance;
}

if (globalThis.SillyTavern?.getContext && globalThis.document) {
    try { install(); } catch (e) { console.error('[随机事件导演] 加载失败；普通聊天不受影响', e); }
}
