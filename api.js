import { apiBase, connectionConfig } from './connections.js';
import { normalizeGeneration } from './headers.js';

export async function requestPool(ctx, messages, settings, signal, connection = { mode: 'current' }) {
    const own = connectionConfig(connection);
    const sampling = normalizeGeneration(settings.headerPreset?.generation);
    if (own.mode === 'independent') {
        const service = ctx.ChatCompletionService;
        if (!service?.sendRequest) throw new Error('此酒馆版本缺少独立请求服务，请更新 SillyTavern');
        const endpoint = apiBase(own.endpoint);
        if (!own.model) throw new Error('请填写副 AI 模型 ID');
        if (/\r|\n/.test(own.apiKey)) throw new Error('API 密钥不能包含换行');
        const presetName = settings.headerPreset ? '' : settings.directorPreset?.completionPresetName || '';
        const preset = presetName ? ctx.getPresetManager?.('openai')?.getCompletionPresetByName?.(presetName) : {};
        if (!preset || typeof preset !== 'object') throw new Error(`副 AI 的酒馆生成参数预设不存在：${presetName}`);
        // Start with a fresh payload. Never inherit another connection's credentials, URL, body or headers.
        const payload = { chat_completion_source: 'custom', custom_url: endpoint,
            custom_include_headers: JSON.stringify({ Authorization: own.apiKey ? `Bearer ${own.apiKey}` : '' }),
            custom_prompt_post_processing: '', model: own.model, messages, stream: false, max_tokens: 2200, n: 1, temperature: 0.8 };
        for (const key of ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty']) {
            if (Number.isFinite(preset[key])) payload[key] = preset[key];
        }
        Object.assign(payload, sampling);
        signal.throwIfAborted();
        try { return (await service.sendRequest(payload, true, signal)).content; }
        catch (e) {
            const message = String(e?.message || '副 AI 请求失败');
            throw new Error(own.apiKey ? message.replaceAll(own.apiKey, '[已隐藏]') : message);
        }
    }
    if (ctx.onlineStatus === 'no_connection') throw new Error('请先连接酒馆 API');
    if (!settings.useCurrentModel && !settings.model.trim()) throw new Error('请选择或填写副 AI 模型 ID');
    const presetName = settings.headerPreset ? '' : settings.directorPreset?.completionPresetName || '';
    const preset = presetName ? ctx.getPresetManager?.(ctx.mainApi)?.getCompletionPresetByName?.(presetName) : {};
    if (!preset || typeof preset !== 'object') throw new Error(`副 AI 的酒馆生成参数预设不存在：${presetName}；请选择其他预设`);
    const overrides = { stream: false, max_tokens: 2200, n: 1, ...sampling };
    if (!presetName && sampling.temperature === undefined) overrides.temperature = 0.8;
    if (!settings.useCurrentModel) overrides.model = settings.model.trim();
    if (ctx.mainApi === 'openai') {
        const service = ctx.ChatCompletionService;
        if (!service?.presetToGeneratePayload || !service?.sendRequest) throw new Error('此酒馆版本缺少 ChatCompletionService；请更新标准 SillyTavern');
        const payload = await service.presetToGeneratePayload(structuredClone(preset), {}, { ...overrides, messages });
        signal.throwIfAborted();
        const result = await service.sendRequest(payload, true, signal);
        return result.content;
    }
    if (ctx.mainApi === 'textgenerationwebui') {
        const service = ctx.TextCompletionService;
        if (!service?.presetToGeneratePayload || !service?.sendRequest) throw new Error('此酒馆版本缺少 TextCompletionService');
        const prompt = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n') + '\n\nASSISTANT:\n';
        const payload = await service.presetToGeneratePayload(structuredClone(preset), {}, { ...overrides, prompt });
        signal.throwIfAborted();
        return (await service.sendRequest(payload, true, signal)).content;
    }
    throw new Error('V0.1 副 AI 支持酒馆 Chat Completion 和 Text Completion 连接；当前 API 暂不支持');
}
export function completionPresets(ctx, api = ctx.mainApi) {
    const names = ctx.getPresetManager?.(api)?.getPresetList?.()?.preset_names;
    return (Array.isArray(names) ? names : Object.keys(names || {})).filter(n => typeof n === 'string').sort();
}
