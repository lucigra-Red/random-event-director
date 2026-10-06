export const KEY = 'random_event_director_v1';
export const DEFAULTS = Object.freeze({ enabled: false, triggerProbability: 25, targetCount: 6,
    refillThreshold: 2, expiryTurns: 7, contextMessages: 16, contextChars: 24000, includeHiddenMessages: false,
    timeoutSeconds: 45, useCurrentModel: true, outgoingInjection: true, model: '', worldNotes: '', directorPreset: null, headerPreset: Object.freeze(builtinHeaderReference()) });
const REPLAY = new Set(['regenerate', 'swipe', 'continue', 'append']);
const ALLOWED = new Set(['normal', 'regenerate', 'swipe', 'continue', 'append']);
const clamp = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
export function config(raw = {}) {
    return { enabled: raw.enabled === true,
        triggerProbability: clamp(raw.triggerProbability, 25, 0, 100),
        targetCount: clamp(raw.targetCount, 6, 1, 20), refillThreshold: clamp(raw.refillThreshold, 2, 0, 19),
        expiryTurns: clamp(raw.expiryTurns, 7, 1, 50), contextMessages: clamp(raw.contextMessages, 16, 1, 40),
        contextChars: clamp(raw.contextChars, 24000, 1000, 60000),
        includeHiddenMessages: raw.includeHiddenMessages === true,
        timeoutSeconds: clamp(raw.timeoutSeconds, 45, 5, 180),
        useCurrentModel: raw.useCurrentModel !== false, model: String(raw.model || '').slice(0, 200),
        outgoingInjection: raw.outgoingInjection !== false,
        worldNotes: String(raw.worldNotes || '').slice(0, 12000), directorPreset: activePreset(raw.directorPreset),
        headerPreset: raw.headerPreset === undefined ? builtinHeaderReference() : activeHeader(raw.headerPreset) };
}
export function randomInt(max, cryptoApi = globalThis.crypto) {
    if (!Number.isSafeInteger(max) || max < 1 || max > 2 ** 32) throw new Error('Invalid random range');
    if (!cryptoApi?.getRandomValues) throw new Error('当前环境不支持 crypto.getRandomValues');
    const limit = Math.floor(2 ** 32 / max) * max;
    const data = new Uint32Array(1);
    do { cryptoApi.getRandomValues(data); } while (data[0] >= limit);
    return data[0] % max;
}
export function choose(events, rng = randomInt) {
    const total = events.reduce((sum, e) => sum + e.weight, 0);
    if (!total) return null;
    let roll = rng(total);
    for (const e of events) { roll -= e.weight; if (roll < 0) return e; }
    throw new Error('Random selection failed');
}
export function uuid(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
    if (!cryptoApi?.getRandomValues) throw new Error('当前环境不支持 crypto.getRandomValues');
    // randomUUID is unavailable on some LAN HTTP pages; getRandomValues still works there.
    const bytes = new Uint8Array(16); cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function parseEvents(text, count, makeId = uuid) {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('副 AI 输出为空或过大');
    let raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    // Accept prose around one JSON object, but never evaluate model output as code.
    if (!raw.startsWith('{')) raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.events)) throw new Error('副 AI 返回缺少 events 数组');
    const result = [], seen = new Set();
    for (const row of parsed.events.slice(0, 60)) {
        if (!row || typeof row.title !== 'string' || typeof row.content !== 'string') continue;
        const title = row.title.trim(), content = row.content.trim();
        if (!title || !content || title.length > 100 || content.length > 1200 || seen.has(content)) continue;
        seen.add(content);
        result.push({ id: makeId(), title, content, type: typeof row.type === 'string' ? row.type.slice(0, 40) : 'situation',
            weight: clamp(row.weight, 10, 1, 100), status: 'available' });
        if (result.length >= count) break;
    }
    if (!result.length) throw new Error('副 AI 没有返回有效的事件起因');
    return result;
}
export function hiddenPrompt(event, preset = null, ctx = {}) { return injectionText(event, preset, ctx); }
function assistantTurns(chat) { return chat.filter(m => !m.is_user && !m.is_system && String(m.mes || '').trim()).length; }
export function chatIdentity(ctx) {
    const id = ctx?.getCurrentChatId?.() ?? ctx?.chatId;
    if (!id || !ctx?.chatMetadata || !Array.isArray(ctx.chat)) return null;
    const owner = ctx.groupId != null ? `group:${ctx.groupId}`
        : `character:${ctx.characters?.[ctx.characterId]?.avatar ?? ctx.characterId}`;
    return `${owner}/${id}`;
}
export function poolPrompt(ctx, state, count) {
    const messages = ctx.chat.filter(m => (state.includeHiddenMessages === true || !m.is_system)
        && String(m.mes || '').trim()).slice(-state.contextMessages);
    let budget = state.contextChars;
    const recent = [];
    for (const m of [...messages].reverse()) {
        if (budget <= 0) break;
        const content = String(m.mes).slice(-Math.min(budget, 6000));
        recent.unshift({ speaker: m.name || (m.is_user ? '玩家' : '角色'), text: content });
        budget -= content.length;
    }
    const card = ctx.characters?.[ctx.characterId] || {};
    const background = [card.description, card.personality, card.scenario, state.worldNotes].filter(Boolean).join('\n').slice(0, 12000);
    return [...headerMessages(state.headerPreset, ctx), { role: 'system', content: generatorText(state.directorPreset, count, ctx) },
    { role: 'user', content: JSON.stringify({ background, recent_story: recent,
        avoid_repeating: [...state.eventPool, ...Object.values(state.cycles).map(c => c.event).filter(Boolean)]
            .slice(-30).map(e => e.content) }) }];
}

export const DEFAULT_SETTINGS_KEY = 'random_event_director_default_settings_v1';
export class Director {
    constructor({ context, request, inject, persist, changed = () => {}, log = console.warn,
        rng = randomInt, makeId = uuid, now = Date.now, defer = fn => setTimeout(fn, 0), presets = null, headers = null, connection = null, diagnostics = null }) {
        Object.assign(this, { context, request, inject, persist, changed, log, rng, makeId, now, defer, presets, headers, connection, diagnostics });
        this.run = null; this.busy = false; this.fill = null; this.epoch = 0; this.disposed = false;
        this.backgroundSeen = false; this.runAbortCleanup = null;
    }
    state(ctx = this.context()) {
        const owner = chatIdentity(ctx);
        if (!owner) return null;
        let state = ctx.chatMetadata[KEY];
        if (!state || state.version !== 1 || state.owner !== owner) {
            state = { ...config({ ...ctx.extensionSettings?.[DEFAULT_SETTINGS_KEY], ...state }), version: 1, owner, eventPool: [], cycles: {}, pendingEvent: null,
                recentEvent: null, eventPoolGenerationTurn: 0, refillAttempt: null, refillStopped: false, generationFailure: null, error: '' };
            ctx.chatMetadata[KEY] = state;
        }
        if (!Array.isArray(state.eventPool) || !state.cycles || typeof state.cycles !== 'object' || Array.isArray(state.cycles)) {
            throw new Error('聊天中的随机事件状态损坏；请关闭插件并重置状态');
        }
        Object.assign(state, config(state));
        state.refillStopped = state.refillStopped === true;
        discussionState(state, ctx.extensionSettings?.[PERSONA_PREFERENCES_KEY]?.defaultPersona);
        return state;
    }
    settingsState(ctx = this.context()) {
        return this.state(ctx) || (ctx.extensionSettings ? config(ctx.extensionSettings[DEFAULT_SETTINGS_KEY]) : null);
    }
    saveDefaults(values, ctx = this.context()) {
        if (!ctx.extensionSettings) throw new Error('酒馆扩展设置不可用，暂时无法保存默认设置');
        const next = config({ ...ctx.extensionSettings[DEFAULT_SETTINGS_KEY], ...values });
        ctx.extensionSettings[DEFAULT_SETTINGS_KEY] = next;
        try { Promise.resolve(ctx.saveSettingsDebounced?.()).catch(e => this.log('[随机事件导演] 默认设置保存失败', e)); }
        catch (e) { this.log('[随机事件导演] 默认设置保存失败', e); }
        this.changed(); return next;
    }
    trace(stage, status, message, details = {}, owner, runId = this.diagnosticRun?.id || '') {
        try { this.diagnostics?.record(stage, status, message, details, { owner, runId }); } catch { /* optional diagnostics */ }
    }
    save(ctx, state) {
        if (this.disposed || ctx.chatMetadata !== this.context()?.chatMetadata || state.owner !== chatIdentity(this.context())) return;
        try { Promise.resolve(this.persist(ctx)).catch(e => this.log('[随机事件导演] 状态保存失败', e)); }
        catch (e) { this.log('[随机事件导演] 状态保存失败', e); }
        this.changed();
    }
    clear() { try { this.inject(''); } catch (e) { this.log('[随机事件导演] 清除注入失败', e); } }
    fail(e) {
        this.log('[随机事件导演]', e);
        try { const ctx = this.context(), s = this.state(ctx); if (s) { s.error = String(e.message || e).slice(0, 300); this.save(ctx, s); } } catch { /* never block host */ }
    }
    generationFailed(ctx, state, error, target) {
        state.refillStopped = true;
        state.generationFailure = { id: this.makeId(), target, message: String(error?.message || error || '未知错误').slice(0, 250) };
        this.save(ctx, state);
    }
    async retryGeneration({ enable = false } = {}) {
        const ctx = this.context(), s = this.state(ctx);
        if (!s || this.disposed || this.busy || this.fill || this.discussion?.guideTask) return false;
        if (enable && !s.enabled) { s.enabled = true; this.save(ctx, s); }
        if (!s.enabled) return false;
        const done = s.generationFailure?.target === 'guide' && s.discussion.guide
            ? await this.discussion?.prepareGuide() : await this.refill(true);
        if (!done || this.context().chatMetadata !== ctx.chatMetadata || chatIdentity(this.context()) !== s.owner) return false;
        return this.rollNow();
    }
    update(values) {
        const ctx = this.context(), s = this.state(ctx);
        if (!s) { this.saveDefaults(values, ctx); return; }
        Object.assign(s, config({ ...s, ...values }));
        if (!s.enabled) { this.runAbortCleanup?.(); this.runAbortCleanup = null; this.cancelFill(); this.clear(); this.run = null; this.busy = false; }
        this.save(ctx, s);
        if (s.enabled && !this.busy) void this.refill();
    }
    cancelFill() { this.epoch++; this.fill?.controller.abort(); this.fill = null; }
    applyHeader(raw) {
        if (this.busy) throw new Error('请等待主生成结束后再应用头部预设');
        const next = raw ? normalizeHeader(raw) : null, ctx = this.context(), s = this.state(ctx);
        if (!s) { this.saveDefaults({ headerPreset: next }, ctx); return; }
        if (next && !next.id) next.id = this.makeId();
        if (JSON.stringify([s.headerPreset?.builtinHeader, s.headerPreset?.nativePresetName, s.headerPreset?.messages, s.headerPreset?.generation])
            !== JSON.stringify([next?.builtinHeader, next?.nativePresetName, next?.messages, next?.generation])) {
            this.cancelFill(); s.eventPool = []; s.refillAttempt = null;
        }
        s.headerPreset = next; s.error = ''; this.save(ctx, s);
        this.discussion?.settingsChanged();
        if (s.enabled) void this.refill();
    }
    applyConnection(raw) {
        if (this.busy) throw new Error('请等待主生成结束后再保存副 AI 配置');
        if (!this.connection) throw new Error('副 AI 连接配置不可用');
        const old = this.connection.read(), next = this.connection.save(raw);
        if (JSON.stringify(old) !== JSON.stringify(next)) {
            this.cancelFill(); const ctx = this.context(), s = this.state(ctx);
            if (s) { s.eventPool = []; s.refillAttempt = null; s.error = ''; this.save(ctx, s); if (s.enabled) void this.refill(); }
            this.discussion?.settingsChanged();
        }
        this.changed(); return next;
    }
    applyPreset(raw) {
        const preset = normalizePreset(raw), ctx = this.context(), s = this.state(ctx);
        if (this.busy) throw new Error('请等待主生成结束后再应用预设');
        if (!s) { this.saveDefaults({ directorPreset: preset }, ctx); return preset; }
        const old = activePreset(s.directorPreset);
        const different = ['generatorPrompt', 'injectionTemplate', 'completionPresetName'].some(key => old[key] !== preset[key]);
        if (different) {
            this.cancelFill(); this.clear(); s.eventPool = []; s.refillAttempt = null;
            if (s.pendingEvent && !s.pendingEvent.injection) s.pendingEvent.injection = hiddenPrompt(s.pendingEvent.event, old, ctx);
        }
        s.directorPreset = { ...preset }; s.error = ''; this.save(ctx, s);
        if (different) this.discussion?.settingsChanged();
        if (different && s.enabled) void this.refill();
        return preset;
    }
    async refill(replace = false) {
        if (this.disposed) return false;
        let ctx, s;
        try { ctx = this.context(); s = this.state(ctx); }
        catch (e) { this.fail(e); return false; }
        if (this.disposed || !s?.enabled || this.busy || this.fill) {
            this.trace('事件池生成', 'skip', '当前聊天未开启、主生成进行中或已有副 AI 请求；本次未生成。', {}, s?.owner, ''); return false;
        }
        if (!replace && s.refillStopped) {
            this.trace('事件池生成', 'skip', '上次事件生成失败，已停止自动生成，等待用户手动重试。', {}, s.owner, ''); return false;
        }
        const turn = assistantTurns(ctx.chat);
        if (s.eventPool.length && turn - s.eventPoolGenerationTurn >= s.expiryTurns) s.eventPool = [];
        if (!replace && s.eventPool.length > Math.min(s.refillThreshold, s.targetCount - 1)) return false;
        if (!replace && s.refillAttempt && (this.now() - s.refillAttempt.time < 30000 || turn < s.refillAttempt.turn + 2)) return false;
        const needed = replace ? s.targetCount : s.targetCount - s.eventPool.length;
        if (needed <= 0) return false;
        const controller = new AbortController(), epoch = this.epoch;
        const task = { controller, epoch, owner: s.owner };
        this.fill = task; s.refillAttempt = { turn, time: this.now() }; s.error = '';
        this.trace('事件池生成', 'info', '开始调用副 AI 生成候选事件。', { needed, poolCount: s.eventPool.length, contextMessages: s.contextMessages }, s.owner, '');
        this.save(ctx, s);
        let timer;
        try {
            const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(new Error('副 AI 超时；正常聊天可继续'));
            }, s.timeoutSeconds * 1000); });
            const response = await Promise.race([this.request(ctx, poolPrompt(ctx, s, needed), s, controller.signal), timeout]);
            this.trace('副 AI 返回', 'success', '已收到副 AI 响应，开始解析事件。', { characters: typeof response === 'string' ? response.length : 0 }, s.owner, '');
            if (this.disposed || controller.signal.aborted || epoch !== this.epoch || this.context().chatMetadata !== ctx.chatMetadata
                || chatIdentity(this.context()) !== s.owner || !s.enabled) {
                this.trace('事件池生成', 'skip', '请求已取消或聊天、配置已变化，丢弃这次返回。', {}, s.owner, ''); return false;
            }
            const events = parseEvents(response, needed, this.makeId);
            const excluded = new Set([...(replace ? [] : s.eventPool), s.pendingEvent?.event,
                ...Object.values(s.cycles).map(c => c.event)].filter(Boolean).map(e => e.content));
            const accepted = events.filter(e => !excluded.has(e.content));
            if (!accepted.length) throw new Error('副 AI 返回的事件全部重复');
            // A top-up keeps the original batch age; replacing/empty pool starts a new age.
            if (replace || !s.eventPool.length) s.eventPoolGenerationTurn = turn;
            s.eventPool = [...(replace ? [] : s.eventPool), ...accepted].slice(0, s.targetCount);
            s.refillStopped = false; s.generationFailure = null;
            this.trace('事件池就绪', 'success', '候选事件已保存；准备好事件池不等于已经注入主 AI。', { count: accepted.length, poolCount: s.eventPool.length }, s.owner, '');
            this.save(ctx, s);
            return true;
        } catch (e) {
            this.trace('事件池生成', 'error', '事件池未生成成功；可能是请求失败、超时、格式无效或事件重复。', {}, s.owner, '');
            if (epoch === this.epoch && !this.disposed && this.context().chatMetadata === ctx.chatMetadata
                && chatIdentity(this.context()) === s.owner) {
                this.generationFailed(ctx, s, e, 'pool');
                this.fail(new Error(`${String(e.message || e)}；已停止自动生成，请手动重试。`));
            }
            return false;
        } finally {
            clearTimeout(timer);
            if (this.fill === task) this.fill = null;
            this.changed();
        }
    }
    start(type = 'normal', options = {}, dryRun = false) {
        if (dryRun) { this.trace('提示词预览', 'skip', '酒馆正在预览提示词；预览不抽取事件，也不运行本插件的注入步骤。', {}, undefined, ''); return; }
        if (!ALLOWED.has(type)) { this.background(type); return; }
        if (this.busy && this.run && this.run.metadata === this.context().chatMetadata && !this.run.completed && !this.run.stopped && !this.run.signal?.aborted) {
            this.run.overlapped = true; this.run.ownershipUncertain = true;
            this.trace('并发保护', 'warn', '已有主回合时又收到正文生成开始；无法区分两次请求，保留事件，不重新抽取或强制消费。'); return;
        }
        this.runAbortCleanup?.(); this.runAbortCleanup = null;
        this.diagnosticRun = { id: this.diagnostics?.begin() || '', eligible: false, intercepted: false, observed: false, injected: false, consumed: false };
        this.trace('主 AI 生成开始', 'info', '收到酒馆的真实生成通知。', { generationType: type });
        this.clear();
        this.busy = true;
        const ctx = this.context(), s = this.state(ctx);
        this.trace('当前连接', 'info', '记录当前主生成使用的 API 类型；地址与密钥不写入日志。', { mainApi: ctx?.mainApi });
        const last = ctx?.chat?.at(-1);
        const replayKey = REPLAY.has(type) && !last?.is_user ? last?.extra?.[KEY]?.cycleKey : null;
        this.run = s?.enabled ? { type, owner: s.owner, metadata: ctx.chatMetadata, replayKey, signal: options.signal,
            stopped: false, cycleKey: null, injected: false, completed: false, overlapped: this.backgroundSeen,
            requestStatus: 'unknown', initialProcessor: ctx.streamingProcessor, assistantCount: assistantTurns(ctx.chat) } : null;
        this.diagnosticRun.eligible = !!this.run;
        const run = this.run;
        if (run?.signal?.addEventListener) {
            const aborted = () => { if (this.run === run) this.stop(true); };
            run.signal.addEventListener('abort', aborted, { once: true });
            this.runAbortCleanup = () => run.signal.removeEventListener('abort', aborted);
            if (run.signal.aborted) aborted();
        }
        if (!s?.enabled) this.trace('聊天检查', 'skip', '当前聊天没有开启随机事件导演，或尚未打开有效聊天。');
    }
    background(type) {
        // Untyped endings cannot be paired with starts. Keep this caution across main turns:
        // a late recall ending from a previous turn must not clear the next turn's injection.
        this.backgroundSeen = true;
        if (this.busy && this.run && !this.run.completed) { this.run.overlapped = true; this.captureProcessor(); }
        this.trace('后台生成隔离', 'skip', '当前主回合以外的生成不抽取事件，也不清空主回合的注入和诊断状态。', { generationType: type }, undefined, '');
    }
    captureProcessor() {
        const run = this.run, processor = this.context()?.streamingProcessor;
        if (run && !run.ownershipUncertain && processor && processor !== run.initialProcessor && (processor.type ?? 'normal') === run.type) run.processor ||= processor;
    }
    requestChecked(check, final = false) {
        const run = this.run;
        if (!run || run.completed || run.stopped || (!final && run.requestFinal)) return;
        if (final) { run.requestFinal = true; run.requestStatus = 'unknown'; }
        if (!check.readable || (check.truncated && !check.found)) return;
        if (final || run.requestStatus !== 'present') run.requestStatus = check.found || (!final && check.eventFound) ? 'present' : 'missing';
        this.captureProcessor();
    }
    anchor(ctx) {
        const user = ctx.chat.findLast(m => m.is_user && !m.is_system);
        const message = user || ctx.chat.findLast(m => !m.is_system);
        if (!message) return 'empty-chat';
        message.extra ||= {};
        message.extra[KEY] ||= {};
        message.extra[KEY].anchorId ||= this.makeId();
        return message.extra[KEY].anchorId;
    }
    intercept(type = 'normal') {
        if (!ALLOWED.has(type)) { this.background(type); return; }
        if (this.run && type !== this.run.type) { this.background(type); return; }
        if (this.run?.ownershipUncertain || this.run?.completed) { this.trace('并发保护', 'skip', '这个拦截器调用无法安全归属到待用主回合，不改写已有注入。'); return; }
        if (this.diagnosticRun) this.diagnosticRun.intercepted = true;
        this.trace('注入回调', 'info', '酒馆已调用本插件的生成拦截器。');
        this.clear();
        const ctx = this.context(), s = this.state(ctx), run = this.run;
        if (!s?.enabled || !run || run.stopped || run.owner !== s.owner || run.metadata !== ctx.chatMetadata) {
            this.trace('注入条件', 'skip', '聊天未开启、未收到有效生成开始通知、生成已停止或聊天已切换。'); return;
        }
        if (ctx.groupId != null && REPLAY.has(type) && !run.replayKey && !s.pendingEvent?.cycleKey) {
            this.trace('注入条件', 'skip', '群聊重生成没有可重放的事件记录。'); return;
        }
        const key = run.replayKey || this.anchor(ctx);
        let cycle = s.cycles[key];
        // Don't invent new random conditions when regenerating pre-installation messages.
        if (!cycle && REPLAY.has(type) && !s.pendingEvent?.cycleKey) {
            this.trace('注入条件', 'skip', '重生成或续写的原消息没有事件记录，不新抽事件。'); return;
        }
        if (!cycle) {
            if (assistantTurns(ctx.chat) - s.eventPoolGenerationTurn >= s.expiryTurns) {
                if (s.eventPool.length) this.trace('事件池过期', 'info', '普通候选事件池已到保留回合，清空旧候选。'); s.eventPool = [];
            }
            let event = null, guideId = null;
            const pendingInjection = s.pendingEvent && !s.pendingEvent.cycleKey ? s.pendingEvent.injection : null;
            if (s.pendingEvent && !s.pendingEvent.cycleKey) {
                event = s.pendingEvent.event; guideId = s.pendingEvent.guideId || null;
                this.trace('事件选择', 'success', '使用“立即掷骰”提前选好的待用事件。');
            } else {
                const roll = this.rng(10000);
                this.trace('随机判定', roll < s.triggerProbability * 100 ? 'success' : 'skip', roll < s.triggerProbability * 100 ? '本轮抽中随机事件，继续选择候选。' : '本轮没有抽中随机事件，这是正常的概率结果。', { roll, probability: s.triggerProbability });
                if (roll < s.triggerProbability * 100) {
                    const guide = s.discussion.guide;
                    if (guide) {
                        event = choose(guide.pool, this.rng); guideId = event ? guide.id : null;
                        // Never block the main generation or substitute an ordinary event for an accepted direction.
                        if (!event && !s.discussion.error) this.defer(() => { void this.discussion?.prepareGuide(); });
                    } else event = choose(s.eventPool, this.rng);
                    if (!event) this.trace('事件选择', 'warn', guide ? '已确认的方向还没有可用候选；本轮不替换为普通事件。' : '事件池为空，本轮没有事件可以注入。', { poolCount: s.eventPool.length, guideCount: guide?.pool.length || 0 });
                }
            }
            if (event) {
                event.status = 'pending';
                s.eventPool = s.eventPool.filter(e => e.id !== event.id);
                s.pendingEvent = { cycleKey: key, event, guideId };
            }
            const injection = event ? (pendingInjection || hiddenPrompt(event, s.directorPreset, ctx)) : '';
            if (event) s.pendingEvent.injection = injection;
            if (event) this.trace('事件绑定', 'success', '已选定一个事件并生成本轮隐藏提示词。', { characters: injection.length });
            cycle = s.cycles[key] = { event, injection, guideId, status: 'pending', createdAt: this.now() };
            this.save(ctx, s);
        } else this.trace('事件重放', 'info', '沿用这个回合原有的事件安排，不重新抽取。');
        run.cycleKey = key;
        if (cycle.status === 'consumed' && !REPLAY.has(type)) { this.trace('注入条件', 'skip', '此回合事件已经使用，正常生成不重复注入。'); return; }
        if (cycle.event) {
            this.trace('调用注入接口', 'info', '准备将本轮事件写入酒馆扩展提示词。');
            this.inject(cycle.injection || hiddenPrompt(cycle.event)); run.injected = true;
            if (this.diagnosticRun) this.diagnosticRun.injected = true;
        } else this.trace('注入结果', 'skip', '本轮没有安排事件，不添加隐藏提示词。');
    }
    receive(messageId, type) {
        const ctx = this.context(), s = this.state(ctx), run = this.run;
        if (!s?.enabled || !run || run.completed || run.stopped || run.signal?.aborted || run.owner !== s.owner
            || run.metadata !== ctx.chatMetadata || !ALLOWED.has(type || run.type) || (type && type !== run.type)) {
            if (this.diagnosticRun?.eligible) this.trace('回复确认', 'skip', '收到回复通知，但没有有效事件回合、请求已停止或聊天已切换；不消费事件。'); return;
        }
        this.captureProcessor();
        const processor = run.processor || (!run.overlapped ? ctx.streamingProcessor : null);
        if (processor?.isStopped || processor?.abortController?.signal.aborted) { this.trace('回复确认', 'skip', '流式生成已停止或取消，不消费事件。'); this.stop(true); return; }
        const m = ctx.chat[messageId];
        if (!m || m.is_user || m.is_system || !String(m.mes || '').trim() || !m.gen_finished) {
            this.trace('回复确认', 'skip', '消息不是完整的 AI 正文，或缺少酒馆的完成标记；暂不消费事件。'); return;
        }
        run.completed = true;
        if (run.ownershipUncertain || run.requestStatus === 'missing'
            || (run.injected && (run.overlapped || run.requestFinal) && run.requestStatus !== 'present')) {
            this.trace('事件保留', 'warn', '主回复已完成，但并发请求归属或事件进入请求的情况未确认；保留待用事件，不标记为已使用。');
            this.clear(); this.busy = false; this.save(ctx, s); return;
        }
        if (!run.cycleKey) { this.clear(); this.busy = false; return; }
        const c = s.cycles[run.cycleKey];
        if (!c || (c.event && !run.injected)) { this.trace('回复确认', 'warn', '缺少本轮事件记录，或事件没有执行注入；不消费事件。'); return; }
        m.extra ||= {};
        m.extra[KEY] = { ...(m.extra[KEY] || {}), cycleKey: run.cycleKey };
        if (Array.isArray(m.swipe_info) && m.swipe_info[m.swipe_id]) {
            m.swipe_info[m.swipe_id].extra ||= {};
            m.swipe_info[m.swipe_id].extra[KEY] = { ...m.extra[KEY] };
        }
        if (c.status !== 'consumed') {
            c.status = 'consumed';
            if (c.event) { c.event.status = 'consumed'; s.recentEvent = { ...c.event }; }
            if (c.guideId && s.discussion.guide?.id === c.guideId) {
                s.discussion.lastUsed = '已使用'; s.discussion.guide = null;
                this.discussion?.guideTask?.controller.abort();
            }
            if (s.pendingEvent?.cycleKey === run.cycleKey) s.pendingEvent = null;
        }
        if (this.diagnosticRun) this.diagnosticRun.consumed = true;
        this.trace('主 AI 回复完成', 'success', c.event ? '收到完整回复，本轮事件已使用；这不代表模型一定遵循了事件。' : '收到完整回复，本轮没有事件。');
        this.clear(); if (run.overlapped) this.busy = false; this.save(ctx, s);
        // MESSAGE_RECEIVED may precede GENERATION_ENDED; defer and let the host finish.
        this.defer(() => { if (!this.busy && !this.disposed) void this.refill(); });
    }
    end(type) {
        if (type && !ALLOWED.has(type)) return;
        if (type && this.run && type !== this.run.type) return;
        this.captureProcessor();
        if (!type && this.busy && this.run?.overlapped && !this.run.completed && !this.run.signal?.aborted
            && !this.run.processor?.isFinished && !this.run.processor?.isStopped && !this.run.processor?.abortController?.signal.aborted) {
            this.trace('并发结束通知', 'skip', '结束通知没有可确认的主请求归属，暂不清除主回合；等待正文完成、主请求取消或用户停止。'); return;
        }
        if (this.diagnosticRun?.eligible && !this.diagnosticRun.intercepted) this.trace('注入回调', 'warn', '主生成已结束，却未收到本插件的拦截器回调；请检查扩展加载或酒馆兼容性。');
        if (this.diagnosticRun?.injected && !this.diagnosticRun.observed) this.trace('请求检测', 'warn', '事件已调用注入接口，但未收到可检测的请求组装通知；无法确认事件是否进入主 AI 请求。');
        this.trace('生成结束', 'info', this.diagnosticRun?.consumed ? '生成结束，事件处理已完成。' : '生成结束；没有确认到完整回复，已选事件不会在此步骤标记为已使用。');
        this.clear(); this.busy = false;
        this.defer(() => { if (!this.busy && !this.disposed) void this.refill(); });
    }
    stop(force = false, type) {
        if (type && (!ALLOWED.has(type) || (this.run && type !== this.run.type))) return;
        this.captureProcessor();
        if (!force && !type && this.busy && this.run?.overlapped && !this.run.signal?.aborted && !this.run.processor?.abortController?.signal.aborted && !this.run.processor?.isStopped) {
            this.trace('并发停止通知', 'skip', '停止通知无法确认属于主请求，不停止当前主回合；主请求自己的取消信号和用户停止按钮仍有效。'); return;
        }
        this.trace('生成停止', 'warn', '主生成被停止；清除当前注入，保留未成功使用的事件安排。');
        if (this.run) this.run.stopped = true; this.clear(); this.busy = false;
    }
    switchChat() {
        this.trace('切换聊天', 'info', '切换聊天，取消旧请求并清除当前隐藏提示词。', {}, undefined, '');
        this.discussion?.cancel();
        this.runAbortCleanup?.(); this.runAbortCleanup = null; this.backgroundSeen = false;
        this.cancelFill(); this.clear(); this.run = null; this.busy = false;
        this.changed();
        // No automatic API request merely from browsing between conversations.
    }
    invalidate(reason, messageId) {
        const ctx = this.context(), s = this.state(ctx);
        if (!s?.enabled) return;
        // Regenerate deletes the prior assistant before its interceptor. Keep the bound decision.
        if (reason === 'delete' && this.run && REPLAY.has(this.run.type) && this.run.metadata === ctx.chatMetadata) return;
        this.cancelFill(); s.eventPool = []; s.refillAttempt = null;
        if (reason === 'edit' && ctx.chat[messageId]?.is_user) {
            const marker = ctx.chat[messageId].extra?.[KEY];
            if (marker?.anchorId) { delete s.cycles[marker.anchorId]; delete marker.anchorId; }
            s.pendingEvent = null;
        }
        const live = new Set(ctx.chat.flatMap(m => [m.extra?.[KEY]?.anchorId, m.extra?.[KEY]?.cycleKey]).filter(Boolean));
        for (const key of Object.keys(s.cycles)) if (!live.has(key) && key !== 'empty-chat') delete s.cycles[key];
        if (s.pendingEvent?.cycleKey && !s.cycles[s.pendingEvent.cycleKey]) s.pendingEvent = null;
        if (s.pendingEvent && !s.pendingEvent.cycleKey) s.pendingEvent = null;
        this.clear(); this.save(ctx, s);
    }
    async rollNow({ enable = false } = {}) {
        this.trace('手动掷骰', 'info', '用户点击立即掷骰；这里只准备事件，要正常发送消息才会注入。', {}, undefined, '');
        const ctx = this.context(), s = this.state(ctx);
        // Enable without starting update()'s background refill: this roll owns the empty-pool request.
        if (enable && s && !this.busy && !s.enabled) { s.enabled = true; this.save(ctx, s); }
        if (!s?.enabled || this.busy) { this.trace('手动掷骰', 'skip', '当前聊天未开启导演，或主 AI 正在生成。', {}, s?.owner, ''); return false; }
        if (s.pendingEvent) return true;
        if (s.discussion.guide) {
            if (!s.discussion.guide.pool.length) await this.discussion?.prepareGuide();
            if (this.context().chatMetadata !== ctx.chatMetadata || !s.enabled || this.busy) return false;
            const guide = s.discussion.guide, event = guide && choose(guide.pool, this.rng);
            if (!event) return false;
            s.pendingEvent = { cycleKey: null, event, guideId: guide.id, injection: hiddenPrompt(event, s.directorPreset, ctx) };
            this.trace('待用事件就绪', 'success', '方向事件已准备，等待下一次正常生成。', {}, s.owner, ''); this.save(ctx, s); return true;
        }
        if (assistantTurns(ctx.chat) - s.eventPoolGenerationTurn >= s.expiryTurns) s.eventPool = [];
        if (!s.eventPool.length) await this.refill(true);
        if (this.context().chatMetadata !== ctx.chatMetadata || !s.enabled || this.busy) return false;
        const event = choose(s.eventPool, this.rng);
        if (!event) return false;
        event.status = 'pending'; s.eventPool = s.eventPool.filter(e => e.id !== event.id);
        s.pendingEvent = { cycleKey: null, event, injection: hiddenPrompt(event, s.directorPreset, ctx) };
        this.trace('待用事件就绪', 'success', '普通事件已准备，等待下一次正常生成。', {}, s.owner, ''); this.save(ctx, s); return true;
    }
    dispose() { this.disposed = true; this.runAbortCleanup?.(); this.runAbortCleanup = null; this.discussion?.cancel(); this.cancelFill(); this.clear(); this.run = null; }
}
import { activePreset, generatorText, injectionText, normalizePreset } from './presets.js';
import { activeHeader, normalizeHeader, headerMessages, builtinHeaderReference } from './headers.js';
import { discussionState } from './discussion-state.js';
import { PERSONA_PREFERENCES_KEY } from './personas.js';
