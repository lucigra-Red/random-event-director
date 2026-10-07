import { Director, uuid } from './engine.js';
import { PresetLibrary } from './presets.js';
import { HeaderLibrary } from './headers.js';
import { ConnectionSettings } from './connections.js';
import { requestPool } from './api.js';
import { mountUI } from './ui.js';
import { Discussion } from './discussion.js';
import { Diagnostics, inspectPrompt, errorCategory } from './diagnostics.js';
import { requestGenerationType, eventGenerationType, stripOwnedInjection } from './request-isolation.js';
import { placeEventInMessages } from './outgoing-injection.js';
import { forcePayload, installRequestTrace } from './request-trace.js';
import { installTavernHelperTrace } from './tavern-helper-trace.js';

const PROMPT_KEY = 'random_event_director_one_turn';
const INSTANCE_KEY = '__randomEventDirectorV1';

export function install(host = globalThis.SillyTavern, doc = globalThis.document) {
    if (!host?.getContext) throw new Error('随机事件导演需要标准 SillyTavern.getContext()');
    globalThis[INSTANCE_KEY]?.dispose();
    const context = () => host.getContext();
    const ctx = context(), bus = ctx.eventSource, events = ctx.eventTypes;
    if (!bus?.on || !events?.GENERATION_STARTED || !ctx.setExtensionPrompt) throw new Error('酒馆缺少生成事件或隐藏提示词接口');
    let ui, requestTrace, injectionActive = false;
    const diagnostics = new Diagnostics(context);
    const presets = new PresetLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const headers = new HeaderLibrary({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced(), makeId: uuid });
    const connection = new ConnectionSettings({ storage: () => context().extensionSettings,
        persist: () => context().saveSettingsDebounced() });
    const director = new Director({ context, request: (ctx, messages, settings, signal) => {
        const config = connection.read();
        requestTrace?.markSecondary(signal);
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
    const helperTrace = installTavernHelperTrace({ context, doc, record: (...args) => director.trace(...args) });
    diagnostics.refreshScripts = () => helperTrace.query();
    requestTrace = installRequestTrace({ context, helperTrace, getEvent: () => {
        const state = director.state(), run = director.run;
        if (state?.forceInjection && run && !run.cycleKey && !run.completed && !run.stopped) director.intercept(run.type);
        return director.forcedEvent();
    },
        onTransport: (...args) => director.transport(...args), record: (...args) => director.trace(...args) });
    const bindings = [], outgoingBindings = [];
    function listen(name, fn, late = false) {
        if (!events[name]) return;
        const guarded = (...args) => {
            try { const result = fn(...args); if (result?.catch) result.catch(e => director.fail(e)); }
            catch (e) { director.trace('宿主事件异常', 'error', errorCategory(e)); director.clear(); director.fail(e); }
        };
        bus.on(events[name], guarded); bindings.push([events[name], guarded]);
        if (late) outgoingBindings.push([events[name], guarded]);
    }
    function rearmOutgoing(finalOnly = false) {
        if (typeof bus.makeLast !== 'function') return;
        for (const [name, handler] of outgoingBindings) {
            if (finalOnly && name === events.GENERATE_AFTER_DATA) continue;
            try { bus.makeLast(name, handler); }
            catch { director.trace('发送前监听顺序', 'warn', '宿主无法调整初月发送前处理的顺序，当前按原监听顺序执行。'); }
        }
    }
    const interceptor = (_chat, _size, _abort, type) => {
        // Synchronous, bounded work only. Never wait for the secondary AI or abort the host.
        try { director.intercept(type); } catch (e) { director.trace('注入异常', 'error', errorCategory(e)); director.clear(); director.fail(e); }
    };
    globalThis.randomEventDirectorInterceptor = interceptor;
    const refreshUI = () => { if (!ui) ui = mountUI(director, context, doc); ui?.refresh(); };
    listen('APP_READY', () => { refreshUI(); rearmOutgoing(); });
    listen('CHAT_CHANGED', () => { director.switchChat(); refreshUI(); });
    listen('CHAT_LOADED', () => { director.switchChat(); refreshUI(); });
    listen('GENERATION_STARTED', (...args) => { director.start(...args); rearmOutgoing(); ui?.refresh(); });
    listen('GENERATION_STOPPED', (...args) => { director.stop(false, eventGenerationType(args)); ui?.refresh(); });
    listen('GENERATION_ENDED', (...args) => { director.end(eventGenerationType(args)); ui?.refresh(); });
    listen('MESSAGE_RECEIVED', (...args) => director.receive(...args));
    listen('MESSAGE_EDITED', id => director.invalidate('edit', id));
    listen('MESSAGE_DELETED', id => director.invalidate('delete', id));
    listen('MESSAGE_SWIPED', id => director.invalidate('swipe', id));
    listen('MESSAGE_SWIPE_DELETED', id => director.invalidate('swipe', id));
    const userStop = event => { if (event.target?.closest?.('#mes_stop')) { director.stop(true); ui?.refresh(); } };
    doc.addEventListener?.('click', userStop, true);
    function observeRequest(payload, dryRun, stage, final = false) {
        if (dryRun) return;
        const state = director.state(), run = director.run;
        if (state?.enabled && state.forceInjection) {
            if (run && !run.cycleKey && !run.stopped && !run.completed && run.metadata === context().chatMetadata) {
                try { director.intercept(run.type); } catch { /* Keep the selected event available to the transport fallback. */ }
            }
            const current = director.forcedEvent();
            if (!current?.injection) return;
            const changed = final && forcePayload(payload, current.injection);
            const check = inspectPrompt(payload, current.injection, current.event.content);
            if (final && run && !run.stopped && !run.completed && run.metadata === current.metadata && check.found) {
                run.injected = true; if (director.diagnosticRun) director.diagnosticRun.injected = true;
                director.requestChecked(check, true);
            }
            director.trace(final ? '强制注入对象' : stage, check.found ? 'success' : 'warn',
                check.found ? '强制模式已在此请求中检测到事件；不因后台类型、重生成或并发归属不明跳过。'
                    : '此阶段没有检测到事件，继续等待传输层检查；没有新抽取事件。',
                { generationType: requestGenerationType(payload) || 'unknown', injectionTarget: Array.isArray(payload?.messages) ? 'system' : 'prompt-prefix',
                    forceInjection: true, changed: Boolean(changed), characters: current.injection.length });
            return;
        }
        if (!state || !run || run.metadata !== context().chatMetadata || state.owner !== run.owner) return;
        const type = requestGenerationType(payload);
        let cycle = state.cycles[run.cycleKey];
        if (type && (!['normal', 'regenerate', 'swipe', 'continue', 'append'].includes(type) || type !== run.type)) {
            if (!run.stopped && !run.completed) director.background(type);
            if (final && cycle?.injection && stripOwnedInjection(payload, cycle.injection)) director.trace('后台请求隔离', 'success', '从明确属于后台的发送数据中移除了初月本轮注入；其他扩展内容与主回合存储保持原样。');
            return;
        }
        if (run.stopped || run.completed) return;
        if (run.ownershipUncertain) {
            if (final && cycle?.injection) stripOwnedInjection(payload, cycle.injection);
            director.trace('请求归属检查', 'warn', '多个正文请求重叠，无法安全确定事件归属；不强制注入，不消费待用事件。'); return;
        }
        if (!type && run.overlapped) {
            director.trace('请求归属检查', 'skip', '此请求没有足够的主回合归属信息，或生成类型不同；不将后台请求当作主回复检测。'); return;
        }
        if (!director.busy || !director.diagnosticRun?.eligible) return;
        if (final) director.requestChecked({ readable: false }, true);
        // The final event carries a type, unlike prompt-ready. Never force a repair into
        // an untyped request that might be a helper's independent recall or summary.
        if (final && type === run.type && state.outgoingInjection && Array.isArray(payload.messages)) {
            if (!run.cycleKey) {
                try { director.intercept(run.type); }
                catch { director.trace('出站事件整理', 'warn', '原生注入接口异常，继续检查已经绑定的事件是否可以直接补写。'); }
                cycle = state.cycles[run.cycleKey];
            }
            if (director.run === run && !run.stopped && !run.completed && !run.ownershipUncertain && cycle?.event && cycle.injection
                && !(cycle.status === 'consumed' && run.type === 'normal')) {
                const result = placeEventInMessages(payload.messages, cycle.injection, {
                    allowUser: ['normal', 'regenerate', 'swipe'].includes(run.type), mode: state.injectionMode });
                if (result.changed) payload.messages = result.messages;
                const verified = inspectPrompt(payload, cycle.injection, cycle.event.content);
                if (verified.found) {
                    run.injected = true; director.diagnosticRun.injected = true;
                    director.trace('出站事件整理', result.changed ? 'success' : 'info', result.changed
                        ? (state.injectionMode === 'system' ? '已将本轮事件整理为一份独立系统消息并自检；不附着在聊天楼层中。'
                            : result.reason === 'moved' ? '已将初月事件整理到玩家消息前部并自检；其他扩展内容保持原样。'
                            : result.count > 1 ? '已合并初月事件的重复副本并自检；其他扩展内容保持原样。'
                                : '发送前发现事件缺失，已从当前回合补回并自检；未重新抽取事件。')
                        : '完整事件已在请求中；当前格式不适合移动，保留原位置，避免破坏预填或其他内容。',
                        { count: result.count || 0, characters: cycle.injection.length, injectionMode: state.injectionMode });
                } else director.trace('出站事件整理', 'warn', '无法确认完整事件已进入当前发送数据；保留事件，不将本次标记为已使用。');
            }
        }
        if (!run.injected || !cycle?.event) {
            director.trace(stage, director.diagnosticRun?.intercepted ? 'skip' : 'warn', director.diagnosticRun?.intercepted
                ? '本轮没有事件注入，组装的请求无需包含事件。' : '已经组装主请求，但没有收到本插件的注入回调。'); return;
        }
        const check = inspectPrompt(payload, cycle.injection, cycle.event.content);
        director.requestChecked(check, final);
        if (director.diagnosticRun) director.diagnosticRun.observed = check.readable || director.diagnosticRun.observed;
        director.trace(stage, !check.readable ? 'warn' : (check.found ? 'success' : (check.eventFound || check.truncated ? 'warn' : 'error')),
            !check.readable ? '此请求数据没有可读取的文本提示词，无法核对注入。'
                : check.found ? '检测到完整事件注入。此检测不代表模型已收到或一定遵循该事件。'
                    : check.truncated ? '请求过长，诊断只检测了部分文本；未检测到完整注入，无法判定丢失。'
                    : check.eventFound ? '检测到事件内容，但完整注入模板不一致；提示词可能被改写。'
                        : '已调用注入接口，但此阶段的主请求中没有检测到事件；请检查提示词组装、截断或其他扩展覆盖。',
            { expectedCharacters: cycle.injection?.length || 0, scannedCharacters: check.scannedCharacters, eventFound: check.eventFound, truncated: check.truncated });
    }
    function observeSafely(payload, dryRun, stage, final = false) {
        try { observeRequest(payload, dryRun, stage, final); }
        catch { director.trace(stage, 'warn', '此阶段的注入检查或整理出现异常；普通聊天继续，无法确认时保留待用事件。'); }
    }
    listen('GENERATE_AFTER_DATA', (data, dryRun) => { rearmOutgoing(true); observeSafely(data, dryRun, '主请求组装检测'); }, true);
    listen('CHAT_COMPLETION_SETTINGS_READY', data => {
        observeSafely(data, false, 'Chat Completion 发送前检测', true); director.rememberMainPrompt(data);
    }, true);
    listen('TEXT_COMPLETION_SETTINGS_READY', data => {
        observeSafely(data, false, 'Text Completion 发送前检测', true); director.rememberMainPrompt(data);
    }, true);
    diagnostics.record('插件加载', 'success', '导演系统已启动。记录实际请求、完整响应、注入对象和可识别的插件调用链；未知来源不作归因。不记录聊天正文、密钥、请求头或完整提示词。',
        { assembledHook: !!events.GENERATE_AFTER_DATA, requestHook: !!events.CHAT_COMPLETION_SETTINGS_READY }, { owner: null });
    if (!events.GENERATE_AFTER_DATA) diagnostics.record('宿主兼容性', 'warn', '酒馆没有提供主请求组装事件；部分注入检测不可用，不能据此判定注入失败。', {}, { owner: null });
    if (!bus.makeLast) diagnostics.record('宿主兼容性', 'warn', '宿主没有监听顺序调整接口；发送前整理仍可运行，但无法确保排在后加载的扩展之后。', {}, { owner: null });
    rearmOutgoing();
    refreshUI();
    function dispose() {
        requestTrace.dispose();
        helperTrace.dispose();
        doc.removeEventListener?.('click', userStop, true);
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
