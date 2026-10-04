// Reuse the native request services. No provider URLs, keys, fetch client, or global model switching.
export async function requestPool(ctx, messages, settings, signal) {
    if (ctx.onlineStatus === 'no_connection') throw new Error('请先连接酒馆 API');
    if (!settings.useCurrentModel && !settings.model.trim()) throw new Error('请选择或填写副 AI 模型 ID');
    const presetName = settings.directorPreset?.completionPresetName || '';
    const preset = presetName ? ctx.getPresetManager?.(ctx.mainApi)?.getCompletionPresetByName?.(presetName) : {};
    if (!preset || typeof preset !== 'object') throw new Error(`副 AI 的酒馆生成参数预设不存在：${presetName}；请选择其他预设`);
    const overrides = { stream: false, max_tokens: 2200, n: 1 };
    if (!presetName) overrides.temperature = 0.8;
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
export function completionPresets(ctx) {
    const names = ctx.getPresetManager?.(ctx.mainApi)?.getPresetList?.()?.preset_names;
    return (Array.isArray(names) ? names : Object.keys(names || {})).filter(n => typeof n === 'string').sort();
}
