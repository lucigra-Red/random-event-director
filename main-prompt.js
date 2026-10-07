import { isSecondaryPayload, requestGenerationType } from './request-isolation.js';

// Capture text only, without request parameters, credentials, images or tool schemas.
export function mainPromptText(payload, state, limit = state.contextChars, cycleKey = null) {
    const source = payload?.messages ?? payload?.prompt;
    const owned = [...new Set([state.cycles[cycleKey]?.injection, state.pendingEvent?.injection,
        ...Object.values(state.cycles).slice(-40).map(c => c.injection)].filter(Boolean))];
    let scanned = 0;
    const clean = value => {
        if (typeof value !== 'string' || scanned >= 2000000) return '';
        let text = value.slice(0, 2000000 - scanned); scanned += text.length;
        for (const injection of owned) text = text.replaceAll(injection, '');
        return text.trim();
    };
    let text;
    if (typeof source === 'string') text = clean(source);
    else if (Array.isArray(source)) text = source.slice(0, 2000).map(row => {
        const body = typeof row?.content === 'string' ? clean(row.content)
            : Array.isArray(row?.content) ? row.content.slice(0, 100).filter(part => part?.type === 'text').map(part => clean(part.text)).filter(Boolean).join('\n') : '';
        const role = ['system', 'user', 'assistant', 'tool', 'function'].includes(row?.role) ? row.role : 'context';
        return body ? `[${role}]\n${body}` : '';
    }).filter(Boolean).join('\n\n');
    else return '';
    if (text.length <= limit) return text;
    // Preserve both initial world/system information and the most recent conversation.
    const marker = '\n[中间部分因字数上限省略]\n';
    const head = Math.floor((limit - marker.length) / 2);
    return text.slice(0, head) + marker + text.slice(-(limit - marker.length - head));
}

// Use the same normal prompt assembly as the prompt viewer. Abort at the final
// settings event, before the host dispatches its main-model fetch.
export class PromptPreview {
    constructor(director, context, doc) { Object.assign(this, { director, context, doc }); this.task = null; }
    async read(ctx, state, signal) {
        if (this.task || this.director.busy || ctx.streamingProcessor && !ctx.streamingProcessor.isFinished)
            throw new Error('主提示词正在组装或主聊天正在生成，请结束后重试');
        const event = ctx.mainApi === 'openai' ? 'CHAT_COMPLETION_SETTINGS_READY' : 'TEXT_COMPLETION_SETTINGS_READY';
        if (!['openai', 'textgenerationwebui'].includes(ctx.mainApi) || typeof ctx.generate !== 'function'
            || typeof ctx.stopGeneration !== 'function' || !ctx.eventTypes?.[event])
            throw new Error('当前酒馆连接无法预览主提示词；请切换聊天补全或文本补全，或关闭“提示词参考”');
        if (signal?.aborted) throw new Error('提示词参考已取消');
        const task = { ctx, state, signal, event, owner: state.owner, metadata: ctx.chatMetadata,
            controller: new AbortController(), text: '', started: false, cancelled: false,
            stopError: new Error('初月提示词预览已截取，未发送主 AI 请求') };
        task.stopError.name = 'AbortError'; this.task = task;
        const input = this.doc?.querySelector?.('#send_textarea'), draft = input?.value;
        const restore = () => { if (input && !input.value && draft) { input.value = draft; input.dispatchEvent(new Event('input', { bubbles: true })); } };
        task.restore = restore;
        // Never execute an unsent slash command or send the user's draft.
        if (input?.value) { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); }
        const cancel = () => {
            task.cancelled = true; task.controller.abort();
            if (task.started) ctx.stopGeneration();
        };
        let timer;
        const stopped = new Promise((_, reject) => {
            task.reject = reject;
            task.cancel = () => { cancel(); reject(new Error('提示词参考已取消')); };
            signal?.addEventListener('abort', task.cancel, { once: true });
            timer = setTimeout(() => { cancel(); reject(new Error('当前提示词组装超时，请检查其他扩展后重试')); }, 20000);
        });
        const generate = Promise.resolve().then(() => {
            if (task.cancelled || signal?.aborted || this.director.disposed || this.context().chatMetadata !== task.metadata)
                throw task.stopError;
            return ctx.generate('normal', { automatic_trigger: true, signal: task.controller.signal });
        }).catch(error => { if (error !== task.stopError && !(task.text && error?.name === 'AbortError')) throw error; }).finally(() => {
            clearTimeout(timer); signal?.removeEventListener('abort', task.cancel); restore();
            if (task.started) ctx.activateSendButtons?.();
            if (this.task === task) this.task = null;
        });
        try {
            await Promise.race([generate, stopped]);
            if (task.cancelled || signal?.aborted || this.director.disposed || this.context().chatMetadata !== task.metadata)
                throw new Error('提示词参考已取消或聊天已切换');
            if (!task.text) throw new Error('未取得当前主提示词，模拟请求可能被其他扩展提前终止；已停止事件生成');
            return task.text;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', task.cancel); restore(); }
    }
    start(options, dryRun) {
        const task = this.task;
        if (!task || dryRun || options?.signal !== task.controller.signal) return false;
        task.started = true; return true;
    }
    capture(name, payload) {
        const task = this.task;
        const type = requestGenerationType(payload);
        if (!task?.started || name !== task.event || isSecondaryPayload(payload)
            || type && type !== 'normal') return;
        if (!task.cancelled && this.context().chatMetadata === task.metadata)
            task.text = mainPromptText(payload, task.state, task.state.contextChars);
        task.controller.abort(); task.ctx.stopGeneration(); task.restore();
        // The host event bus catches listener errors. Aborting the host plus the
        // transport barrier below is required; throwing from a hook is not enough.
    }
    blockRequest({ route, payload, secondary }) {
        const task = this.task;
        if (!task?.started || secondary || !['chat-backend', 'text-backend'].includes(route)) return null;
        const type = requestGenerationType(payload);
        if (['quiet', 'impersonate'].includes(type)) return null;
        return task.stopError;
    }
    cancel() { this.task?.cancel?.(); }
}
