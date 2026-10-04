export const KEY = 'random_event_director_v1';
export const DEFAULTS = Object.freeze({ enabled: false, triggerProbability: 25, targetCount: 6,
    refillThreshold: 2, expiryTurns: 7, contextMessages: 16, contextChars: 24000,
    timeoutSeconds: 45, useCurrentModel: true, model: '', worldNotes: '', directorPreset: null, headerPreset: null });
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
        timeoutSeconds: clamp(raw.timeoutSeconds, 45, 5, 180),
        useCurrentModel: raw.useCurrentModel !== false, model: String(raw.model || '').slice(0, 200),
        worldNotes: String(raw.worldNotes || '').slice(0, 12000), directorPreset: activePreset(raw.directorPreset), headerPreset: activeHeader(raw.headerPreset) };
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
    const messages = ctx.chat.filter(m => !m.is_system && String(m.mes || '').trim()).slice(-state.contextMessages);
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

export class Director {
    constructor({ context, request, inject, persist, changed = () => {}, log = console.warn,
        rng = randomInt, makeId = uuid, now = Date.now, defer = fn => setTimeout(fn, 0), presets = null, headers = null, connection = null }) {
        Object.assign(this, { context, request, inject, persist, changed, log, rng, makeId, now, defer, presets, headers, connection });
        this.run = null; this.busy = false; this.fill = null; this.epoch = 0; this.disposed = false;
    }
    state(ctx = this.context()) {
        const owner = chatIdentity(ctx);
        if (!owner) return null;
        let state = ctx.chatMetadata[KEY];
        if (!state || state.version !== 1 || state.owner !== owner) {
            state = { ...config(state), version: 1, owner, eventPool: [], cycles: {}, pendingEvent: null,
                recentEvent: null, eventPoolGenerationTurn: 0, refillAttempt: null, error: '' };
            ctx.chatMetadata[KEY] = state;
        }
        if (!Array.isArray(state.eventPool) || !state.cycles || typeof state.cycles !== 'object' || Array.isArray(state.cycles)) {
            throw new Error('聊天中的随机事件状态损坏；请关闭插件并重置状态');
        }
        Object.assign(state, config(state));
        discussionState(state);
        return state;
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
    update(values) {
        const ctx = this.context(), s = this.state(ctx);
        if (!s) return;
        Object.assign(s, config({ ...s, ...values }));
        if (!s.enabled) { this.cancelFill(); this.clear(); this.run = null; }
        this.save(ctx, s);
        if (s.enabled && !this.busy) void this.refill();
    }
    cancelFill() { this.epoch++; this.fill?.controller.abort(); this.fill = null; }
    applyHeader(raw) {
        if (this.busy) throw new Error('请等待主生成结束后再应用头部预设');
        const next = raw ? normalizeHeader(raw) : null, ctx = this.context(), s = this.state(ctx);
        if (!s) throw new Error('请先打开一个聊天');
        if (next && !next.id) next.id = this.makeId();
        if (JSON.stringify([s.headerPreset?.messages, s.headerPreset?.generation]) !== JSON.stringify([next?.messages, next?.generation])) {
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
        if (!s) throw new Error('请先打开一个聊天');
        if (this.busy) throw new Error('请等待主生成结束后再应用预设');
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
        if (this.disposed || !s?.enabled || this.busy || this.fill) return false;
        const turn = assistantTurns(ctx.chat);
        if (s.eventPool.length && turn - s.eventPoolGenerationTurn >= s.expiryTurns) s.eventPool = [];
        if (!replace && s.eventPool.length > Math.min(s.refillThreshold, s.targetCount - 1)) return false;
        if (!replace && s.refillAttempt && (this.now() - s.refillAttempt.time < 30000 || turn < s.refillAttempt.turn + 2)) return false;
        const needed = replace ? s.targetCount : s.targetCount - s.eventPool.length;
        if (needed <= 0) return false;
        const controller = new AbortController(), epoch = this.epoch;
        const task = { controller, epoch, owner: s.owner };
        this.fill = task; s.refillAttempt = { turn, time: this.now() }; s.error = '';
        this.save(ctx, s);
        let timer;
        try {
            const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
                controller.abort(); reject(new Error('副 AI 超时；正常聊天可继续'));
            }, s.timeoutSeconds * 1000); });
            const response = await Promise.race([this.request(ctx, poolPrompt(ctx, s, needed), s, controller.signal), timeout]);
            if (this.disposed || controller.signal.aborted || epoch !== this.epoch || this.context().chatMetadata !== ctx.chatMetadata
                || chatIdentity(this.context()) !== s.owner || !s.enabled) return false;
            const events = parseEvents(response, needed, this.makeId);
            const excluded = new Set([...(replace ? [] : s.eventPool), s.pendingEvent?.event,
                ...Object.values(s.cycles).map(c => c.event)].filter(Boolean).map(e => e.content));
            const accepted = events.filter(e => !excluded.has(e.content));
            if (!accepted.length) throw new Error('副 AI 返回的事件全部重复');
            // A top-up keeps the original batch age; replacing/empty pool starts a new age.
            if (replace || !s.eventPool.length) s.eventPoolGenerationTurn = turn;
            s.eventPool = [...(replace ? [] : s.eventPool), ...accepted].slice(0, s.targetCount);
            this.save(ctx, s);
            return true;
        } catch (e) {
            if (epoch === this.epoch && !this.disposed && this.context().chatMetadata === ctx.chatMetadata) this.fail(e);
            return false;
        } finally {
            clearTimeout(timer);
            if (this.fill === task) this.fill = null;
            this.changed();
        }
    }
    start(type = 'normal', options = {}, dryRun = false) {
        if (dryRun) return;
        // quiet/impersonation never use our event, even if another extension initiates them.
        this.clear();
        if (!ALLOWED.has(type)) return;
        this.busy = true;
        const ctx = this.context(), s = this.state(ctx);
        const last = ctx?.chat?.at(-1);
        const replayKey = REPLAY.has(type) && !last?.is_user ? last?.extra?.[KEY]?.cycleKey : null;
        this.run = s?.enabled ? { type, owner: s.owner, metadata: ctx.chatMetadata, replayKey, signal: options.signal,
            stopped: false, cycleKey: null, injected: false, assistantCount: assistantTurns(ctx.chat) } : null;
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
        this.clear();
        if (!ALLOWED.has(type)) return;
        const ctx = this.context(), s = this.state(ctx), run = this.run;
        if (!s?.enabled || !run || run.stopped || run.owner !== s.owner || run.metadata !== ctx.chatMetadata) return;
        if (ctx.groupId != null && REPLAY.has(type) && !run.replayKey && !s.pendingEvent?.cycleKey) return;
        const key = run.replayKey || this.anchor(ctx);
        let cycle = s.cycles[key];
        // Don't invent new random conditions when regenerating pre-installation messages.
        if (!cycle && REPLAY.has(type) && !s.pendingEvent?.cycleKey) return;
        if (!cycle) {
            if (assistantTurns(ctx.chat) - s.eventPoolGenerationTurn >= s.expiryTurns) s.eventPool = [];
            let event = null, guideId = null;
            const pendingInjection = s.pendingEvent && !s.pendingEvent.cycleKey ? s.pendingEvent.injection : null;
            if (s.pendingEvent && !s.pendingEvent.cycleKey) { event = s.pendingEvent.event; guideId = s.pendingEvent.guideId || null; }
            else if (this.rng(10000) < s.triggerProbability * 100) {
                const guide = s.discussion.guide;
                if (guide) {
                    event = choose(guide.pool, this.rng); guideId = event ? guide.id : null;
                    // Never block the main generation or substitute an ordinary event for an accepted direction.
                    if (!event && !s.discussion.error) this.defer(() => { void this.discussion?.prepareGuide(); });
                } else event = choose(s.eventPool, this.rng);
            }
            if (event) {
                event.status = 'pending';
                s.eventPool = s.eventPool.filter(e => e.id !== event.id);
                s.pendingEvent = { cycleKey: key, event, guideId };
            }
            const injection = event ? (pendingInjection || hiddenPrompt(event, s.directorPreset, ctx)) : '';
            if (event) s.pendingEvent.injection = injection;
            cycle = s.cycles[key] = { event, injection, guideId, status: 'pending', createdAt: this.now() };
            this.save(ctx, s);
        }
        run.cycleKey = key;
        if (cycle.status === 'consumed' && !REPLAY.has(type)) return;
        if (cycle.event) { this.inject(cycle.injection || hiddenPrompt(cycle.event)); run.injected = true; }
    }
    receive(messageId, type) {
        const ctx = this.context(), s = this.state(ctx), run = this.run;
        if (!s?.enabled || !run?.cycleKey || run.stopped || run.signal?.aborted || run.owner !== s.owner
            || run.metadata !== ctx.chatMetadata || !ALLOWED.has(type || run.type)) return;
        const processor = ctx.streamingProcessor;
        if (processor?.isStopped || processor?.abortController?.signal.aborted) return;
        const m = ctx.chat[messageId];
        if (!m || m.is_user || m.is_system || !String(m.mes || '').trim() || !m.gen_finished) return;
        const c = s.cycles[run.cycleKey];
        if (!c || (c.event && !run.injected)) return;
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
        this.clear(); this.save(ctx, s);
        // MESSAGE_RECEIVED may precede GENERATION_ENDED; defer and let the host finish.
        this.defer(() => { if (!this.busy && !this.disposed) void this.refill(); });
    }
    end() {
        this.clear(); this.busy = false;
        this.defer(() => { if (!this.busy && !this.disposed) void this.refill(); });
    }
    stop() { if (this.run) this.run.stopped = true; this.clear(); this.busy = false; }
    switchChat() {
        this.discussion?.cancel();
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
    async rollNow() {
        const ctx = this.context(), s = this.state(ctx);
        if (!s?.enabled || this.busy) return false;
        if (s.pendingEvent) return true;
        if (s.discussion.guide) {
            if (!s.discussion.guide.pool.length) await this.discussion?.prepareGuide();
            if (this.context().chatMetadata !== ctx.chatMetadata || !s.enabled || this.busy) return false;
            const guide = s.discussion.guide, event = guide && choose(guide.pool, this.rng);
            if (!event) return false;
            s.pendingEvent = { cycleKey: null, event, guideId: guide.id, injection: hiddenPrompt(event, s.directorPreset, ctx) };
            this.save(ctx, s); return true;
        }
        if (assistantTurns(ctx.chat) - s.eventPoolGenerationTurn >= s.expiryTurns) s.eventPool = [];
        if (!s.eventPool.length) await this.refill(true);
        if (this.context().chatMetadata !== ctx.chatMetadata || !s.enabled || this.busy) return false;
        const event = choose(s.eventPool, this.rng);
        if (!event) return false;
        event.status = 'pending'; s.eventPool = s.eventPool.filter(e => e.id !== event.id);
        s.pendingEvent = { cycleKey: null, event, injection: hiddenPrompt(event, s.directorPreset, ctx) };
        this.save(ctx, s); return true;
    }
    dispose() { this.disposed = true; this.discussion?.cancel(); this.cancelFill(); this.clear(); this.run = null; }
}
import { activePreset, generatorText, injectionText, normalizePreset } from './presets.js';
import { activeHeader, normalizeHeader, headerMessages } from './headers.js';
import { discussionState } from './discussion-state.js';
