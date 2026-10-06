import { apiBase, connectionConfig } from './connections.js';
import { normalizeGeneration, nativePreset, nativeSampling, nativeGenerationPreset } from './headers.js';

export async function requestModels(ctx, connection, signal, fetchImpl = globalThis.fetch) {
    const own = connectionConfig(connection);
    if (own.mode !== 'independent') throw new Error('请先选择独立副 AI 连接');
    const endpoint = apiBase(own.endpoint);
    if (/\r|\n/.test(own.apiKey)) throw new Error('API 密钥不能包含换行');
    if (!ctx.getRequestHeaders) throw new Error('此酒馆版本缺少请求服务，请更新 SillyTavern');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
        const response = await fetchImpl('/api/backends/chat-completions/status', {
            method: 'POST', headers: ctx.getRequestHeaders(), signal: controller.signal,
            body: JSON.stringify({ chat_completion_source: 'custom', custom_url: endpoint,
                custom_include_headers: JSON.stringify({ Authorization: own.apiKey ? `Bearer ${own.apiKey}` : '' }) }),
        });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new Error();
        const data = await response.json();
        controller.signal.throwIfAborted();
        if (data?.error || !Array.isArray(data?.data)) throw new Error();
        const models = [...new Set(data.data.map(model => model?.id).filter(id =>
            typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 200 && !/[\x00-\x1f\x7f]/.test(id)))].sort();
        if (!models.length) throw new Error('empty');
        return models;
    } catch (e) {
        signal?.throwIfAborted();
        if (timedOut) throw new Error('拉取模型超时，请稍后重试；也可以手动填写模型 ID。');
        if (e.message === 'empty') throw new Error('接口未返回可用模型，请手动填写模型 ID。');
        throw new Error('拉取模型失败，请检查副 API 地址和密钥；接口需支持模型列表，也可以手动填写模型 ID。');
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
    }
}

export async function requestPool(ctx, messages, settings, signal, connection = { mode: 'current' }) {
    const own = connectionConfig(connection);
    const native = nativePreset(settings.headerPreset, ctx);
    const sampling = native ? nativeSampling(native) : normalizeGeneration(settings.headerPreset?.generation);
    if (own.mode === 'independent') {
        const service = ctx.ChatCompletionService;
        if (!service?.sendRequest) throw new Error('此酒馆版本缺少独立请求服务，请更新 SillyTavern');
        const endpoint = apiBase(own.endpoint);
        if (!own.model) throw new Error('请填写副 AI 模型 ID');
        if (/\r|\n/.test(own.apiKey)) throw new Error('API 密钥不能包含换行');
        const presetName = settings.headerPreset ? '' : settings.directorPreset?.completionPresetName || '';
        const preset = native || (presetName ? ctx.getPresetManager?.('openai')?.getCompletionPresetByName?.(presetName) : {});
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
    const preset = native ? nativeGenerationPreset(native) : (presetName ? ctx.getPresetManager?.(ctx.mainApi)?.getCompletionPresetByName?.(presetName) : {});
    if (!preset || typeof preset !== 'object') throw new Error(`副 AI 的酒馆生成参数预设不存在：${presetName}；请选择其他预设`);
    const overrides = { stream: false, max_tokens: 2200, n: 1, ...sampling };
    if (!native && !presetName && sampling.temperature === undefined) overrides.temperature = 0.8;
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
