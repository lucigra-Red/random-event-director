import { apiBase, connectionConfig } from './connections.js';
import { nativePreset } from './headers.js';
import { markSecondaryPayload } from './request-isolation.js';

const SAMPLING_KEYS = Object.freeze(['presence_penalty', 'frequency_penalty', 'top_p', 'top_k', 'temperature']);
const COMPATIBILITY_KEYS = [...SAMPLING_KEYS, 'reasoning_effort'];
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
function readCustomConfig(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { return JSON.parse(raw); }
    catch {
        const parser = globalThis.SillyTavern?.libs?.yaml;
        if (!parser?.parse) throw new Error('酒馆缺少 YAML 解析接口，请更新酒馆或将自定义请求参数改为 JSON。');
        // Invalid YAML is also ignored by the host backend.
        try { return parser.parse(raw); } catch { return null; }
    }
}
function normalizeReasoning(body) {
    const value = body.reasoning_effort === 'min' ? 'minimal' : body.reasoning_effort;
    if (REASONING_EFFORTS.has(value)) body.reasoning_effort = value;
    else delete body.reasoning_effort; // "auto" is a host setting, not an API value.
}
function omitSampling(payload, enabled) {
    // Filter after the host applies its current preset, without changing the host's shared settings.
    const result = { ...payload };
    if (enabled) for (const key of COMPATIBILITY_KEYS) delete result[key];
    else if (['custom', 'openai', 'azure_openai'].includes(result.chat_completion_source)) normalizeReasoning(result);
    if (result.chat_completion_source === 'custom') {
        // The server merges custom_include_body later. Its exclusion list must also remove these keys.
        if (enabled) {
            const parsed = readCustomConfig(result.custom_exclude_body);
            const existing = Array.isArray(parsed) ? parsed.filter(key => typeof key === 'string')
                : typeof parsed === 'string' ? [parsed] : parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
            result.custom_exclude_body = JSON.stringify([...new Set([...existing, ...COMPATIBILITY_KEYS])]);
        } else {
            const extra = readCustomConfig(result.custom_include_body);
            if (extra && typeof extra === 'object' && !Array.isArray(extra) && Object.hasOwn(extra, 'reasoning_effort')) {
                const normalized = { ...extra }; normalizeReasoning(normalized);
                if (normalized.reasoning_effort !== extra.reasoning_effort) result.custom_include_body = JSON.stringify(normalized);
            }
        }
    }
    return result;
}

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
    const send = (service, payload) => {
        const outbound = omitSampling(payload, own.excludeSampling);
        markSecondaryPayload(outbound);
        return service.sendRequest(outbound, true, signal);
    };
    // Headers supply text through the caller's messages, never generation parameters.
    // Validate a selected native reference, but do not pass it to the host request converter.
    nativePreset(settings.headerPreset, ctx);
    if (own.mode === 'independent') {
        const service = ctx.ChatCompletionService;
        if (!service?.sendRequest) throw new Error('此酒馆版本缺少独立请求服务，请更新 SillyTavern');
        const endpoint = apiBase(own.endpoint);
        if (!own.model) throw new Error('请填写副 AI 模型 ID');
        if (/\r|\n/.test(own.apiKey)) throw new Error('API 密钥不能包含换行');
        // Start with a fresh payload. Never inherit another connection's credentials, URL, body or headers.
        const payload = { chat_completion_source: 'custom', custom_url: endpoint,
            custom_include_headers: JSON.stringify({ Authorization: own.apiKey ? `Bearer ${own.apiKey}` : '' }),
            custom_prompt_post_processing: '', model: own.model, messages, stream: false, max_tokens: 2200, n: 1, temperature: 0.8 };
        signal.throwIfAborted();
        try { return (await send(service, payload)).content; }
        catch (e) {
            const message = String(e?.message || '副 AI 请求失败');
            throw new Error(own.apiKey ? message.replaceAll(own.apiKey, '[已隐藏]') : message);
        }
    }
    if (ctx.onlineStatus === 'no_connection') throw new Error('请先连接酒馆 API');
    if (!settings.useCurrentModel && !settings.model.trim()) throw new Error('请选择或填写副 AI 模型 ID');
    const overrides = { stream: false, max_tokens: 2200, n: 1, temperature: 0.8 };
    if (!settings.useCurrentModel) overrides.model = settings.model.trim();
    if (ctx.mainApi === 'openai') {
        const service = ctx.ChatCompletionService;
        if (!service?.presetToGeneratePayload || !service?.sendRequest) throw new Error('此酒馆版本缺少 ChatCompletionService；请更新标准 SillyTavern');
        const payload = await service.presetToGeneratePayload({}, {}, { ...overrides, messages });
        signal.throwIfAborted();
        const result = await send(service, payload);
        return result.content;
    }
    if (ctx.mainApi === 'textgenerationwebui') {
        const service = ctx.TextCompletionService;
        if (!service?.presetToGeneratePayload || !service?.sendRequest) throw new Error('此酒馆版本缺少 TextCompletionService');
        const prompt = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n') + '\n\nASSISTANT:\n';
        const payload = await service.presetToGeneratePayload({}, {}, { ...overrides, prompt });
        signal.throwIfAborted();
        return (await send(service, payload)).content;
    }
    throw new Error('V0.1 副 AI 支持酒馆 Chat Completion 和 Text Completion 连接；当前 API 暂不支持');
}
export function completionPresets(ctx, api = ctx.mainApi) {
    const names = ctx.getPresetManager?.(api)?.getPresetList?.()?.preset_names;
    return (Array.isArray(names) ? names : Object.keys(names || {})).filter(n => typeof n === 'string').sort();
}
