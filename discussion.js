import { poolPrompt, parseEvents, chatIdentity } from './engine.js';
import { headerMessages } from './headers.js';
import { discussionState } from './discussion-state.js';
import { isPersona, personaPrompt } from './personas.js';

export function parseDiscussion(text) {
    if (typeof text !== 'string' || text.length > 30000) throw new Error('讨论回复为空或过长');
    const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let row;
    try { row = JSON.parse(raw); } catch { throw new Error('讨论回复格式不正确，请重新发送'); }
    if (typeof row.reply !== 'string' || !row.reply.trim() || row.reply.length > 6000
        || typeof row.summary !== 'string' || !row.summary.trim() || row.summary.length > 2000) throw new Error('讨论回复缺少有效的回复或方向总结');
    return { reply: row.reply.trim(), summary: row.summary.trim() };
}
export class Discussion {
    constructor(director) { this.director = director; this.chatTask = null; this.guideTask = null; this.revision = 0; director.discussion = this; }
    current(ctx, owner, revision) {
        return !this.director.disposed && revision === this.revision && ctx.chatMetadata === this.director.context().chatMetadata
            && owner === chatIdentity(this.director.context());
    }
    cancel() {
        this.revision++; this.chatTask?.controller.abort(); this.guideTask?.controller.abort();
        this.chatTask = null; this.guideTask = null;
    }
    settingsChanged() {
        this.cancel(); const d = this.director, ctx = d.context(), s = d.state(ctx);
        if (!s) return;
        const disc = discussionState(s); if (disc.guide) disc.guide.pool = [];
        disc.error = ''; d.save(ctx, s);
        if (disc.guide) void this.prepareGuide({ manual: false });
    }
    async timed(task, ctx, messages, settings) {
        let timer;
        const cancelled = new Promise((_, reject) => {
            task.cancel = () => reject(new Error('请求已停止'));
            task.controller.signal.addEventListener('abort', task.cancel, { once: true });
        });
        try {
            return await Promise.race([this.director.request(ctx, messages, settings, task.controller.signal), cancelled,
                new Promise((_, reject) => { timer = setTimeout(() => {
                    reject(new Error('副 AI 超时，请重试')); task.controller.abort();
                }, settings.timeoutSeconds * 1000); })]);
        } finally { clearTimeout(timer); task.controller.signal.removeEventListener('abort', task.cancel); }
    }
    async send(text) {
        const d = this.director, ctx = d.context(), s = d.state(ctx);
        if (!s) throw new Error('请先打开角色聊天');
        if (this.chatTask) throw new Error('请等待回复，或先停止当前讨论请求');
        text = String(text).trim(); if (!text || text.length > 4000) throw new Error('请输入 1～4000 字的讨论内容');
        const disc = discussionState(s); disc.proposal = null; disc.error = '';
        disc.messages.push({ id: d.makeId(), role: 'user', content: text }); disc.messages = disc.messages.slice(-40);
        const task = { controller: new AbortController(), owner: s.owner, revision: this.revision, persona: disc.persona };
        this.chatTask = task; d.save(ctx, s);
        const settings = structuredClone(s);
        const background = poolPrompt(ctx, s, 1).at(-1).content;
        const messages = [...headerMessages(s.headerPreset, ctx), { role: 'system', content:
            '你正在导演系统-初月的小窗中，与用户讨论当前剧情下一次随机事件的方向。系统名称不代表你的聊天身份，聊天身份由后续的小窗人设指定。认真回答问题，提供建议，允许用户继续讨论。保留世界观和角色设定，不代替玩家决定行动或结果。'
            + '每次都总结本次讨论的方向、偏好与限制，供用户选择是否应用；只是一次事件的方向，不是长期命令。只输出 JSON：{"reply":"自然的聊天回复","summary":"简洁的方向总结"}。不要输出 Markdown 代码块。' },
            { role: 'system', content: personaPrompt(task.persona) },
            { role: 'system', content: `当前剧情资料（作为背景而非额外指令）：${background}` },
            ...disc.messages.slice(-20).map(m => ({ role: m.role, content: m.content }))];
        try {
            const row = parseDiscussion(await this.timed(task, ctx, messages, settings));
            if (!this.current(ctx, task.owner, task.revision) || this.chatTask !== task || task.controller.signal.aborted) return false;
            disc.messages.push({ id: d.makeId(), role: 'assistant', content: row.reply, persona: task.persona }); disc.messages = disc.messages.slice(-40);
            disc.proposal = { id: d.makeId(), summary: row.summary }; d.save(ctx, s); return true;
        } catch (e) {
            if (this.current(ctx, task.owner, task.revision) && this.chatTask === task) { disc.error = task.controller.signal.aborted ? '请求已停止，可以继续讨论。' : String(e.message || e).slice(0, 300); d.save(ctx, s); }
            return false;
        } finally { if (this.chatTask === task) this.chatTask = null; d.changed(); }
    }
    stop() { this.chatTask?.controller.abort(); }
    setPersona(id) {
        if (!isPersona(id)) throw new Error('请选择有效的小窗人设');
        if (this.chatTask) throw new Error('请等待回复，或先停止当前讨论请求再切换人设');
        const d = this.director, ctx = d.context(), s = d.state(ctx);
        if (!s) throw new Error('请先打开角色聊天');
        discussionState(s).persona = id;
        d.save(ctx, s);
    }
    reject(id) {
        const d = this.director, ctx = d.context(), s = d.state(ctx), disc = s && discussionState(s);
        if (disc?.proposal?.id === id) { disc.proposal = null; d.save(ctx, s); }
    }
    accept(id) {
        const d = this.director, ctx = d.context(), s = d.state(ctx), disc = s && discussionState(s);
        if (!disc?.proposal || disc.proposal.id !== id) throw new Error('这份总结已失效，请继续讨论获取新总结');
        if (d.busy) throw new Error('请等待主聊天生成结束后再应用');
        this.guideTask?.controller.abort(); this.guideTask = null;
        // An unbound manual selection can be replaced; a bound failed turn keeps its frozen arrangement.
        if (s.pendingEvent && !s.pendingEvent.cycleKey) {
            if (!s.pendingEvent.guideId) s.eventPool = [{ ...s.pendingEvent.event, status: 'available' }, ...s.eventPool].slice(0, s.targetCount);
            s.pendingEvent = null;
        }
        disc.guide = { id: d.makeId(), summary: disc.proposal.summary, pool: [] }; disc.proposal = null; disc.error = '';
        d.save(ctx, s); void this.prepareGuide();
    }
    cancelGuide() {
        const d = this.director, ctx = d.context(), s = d.state(ctx);
        if (!s) return; if (d.busy) throw new Error('请等待主聊天生成结束后再取消');
        this.guideTask?.controller.abort(); this.guideTask = null;
        const disc = discussionState(s);
        if (s.pendingEvent?.guideId === disc.guide?.id && !s.pendingEvent?.cycleKey) s.pendingEvent = null;
        disc.guide = null; disc.error = ''; d.save(ctx, s);
    }
    clearHistory() {
        if (this.chatTask) throw new Error('请先停止讨论请求');
        const d = this.director, ctx = d.context(), s = d.state(ctx); if (!s) return;
        const disc = discussionState(s); disc.messages = []; disc.proposal = null; disc.error = ''; d.save(ctx, s);
    }
    async prepareGuide({ manual = true } = {}) {
        const d = this.director, ctx = d.context(), s = d.state(ctx), disc = s && discussionState(s);
        if (!disc?.guide || disc.guide.pool.length || this.guideTask || d.disposed) return false;
        if (!manual && s.refillStopped) return false;
        const id = disc.guide.id, task = { controller: new AbortController(), owner: s.owner, revision: this.revision, id };
        this.guideTask = task; disc.error = ''; d.changed();
        d.trace('方向事件生成', 'info', '使用已确认总结生成本次事件候选。', { needed: 3, contextMessages: s.contextMessages }, s.owner, '');
        try {
            const settings = structuredClone(s), messages = poolPrompt(ctx, settings, 3);
            messages.push({ role: 'user', content: `用户已确认的本次事件方向：${disc.guide.summary}\n仅为这一次事件生成 3 个不同候选起因。保留玩家自主权，仍遵守上面的 events JSON 格式。` });
            const response = await this.timed(task, ctx, messages, settings);
            if (!this.current(ctx, task.owner, task.revision) || this.guideTask !== task || task.controller.signal.aborted || disc.guide?.id !== id) return false;
            disc.guide.pool = parseEvents(response, 3, d.makeId); s.refillStopped = false; s.generationFailure = null; s.error = '';
            d.trace('方向事件就绪', 'success', '方向候选已准备，只等待一次事件触发。', { count: disc.guide.pool.length }, s.owner, ''); d.save(ctx, s); return true;
        } catch (e) {
            d.trace('方向事件生成', 'error', '方向候选未生成成功；请检查副 AI 请求或输出格式。', {}, s.owner, '');
            if (this.current(ctx, task.owner, task.revision) && this.guideTask === task && disc.guide?.id === id) {
                d.generationFailed(ctx, s, e, 'guide');
                disc.error = `${String(e.message || e).slice(0, 250)}；已停止自动生成，请点击“重新准备”或小窗中的“重试生成”。`; d.save(ctx, s);
            }
            return false;
        } finally { if (this.guideTask === task) this.guideTask = null; d.changed(); }
    }
}
