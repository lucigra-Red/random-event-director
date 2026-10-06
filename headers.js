export const HEADER_KEY = 'random_event_director_headers_v1';
const ROLES = new Set(['system', 'user', 'assistant']);
export function normalizeGeneration(raw = {}) {
    const result = {}, limits = { temperature: [0, 2], top_p: [0, 1], top_k: [0, 1000],
        frequency_penalty: [-2, 2], presence_penalty: [-2, 2], max_tokens: [128, 32768] };
    for (const [key, [min, max]] of Object.entries(limits)) {
        if (raw[key] === undefined || raw[key] === '') continue;
        const value = Number(raw[key]);
        if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${key} 须在 ${min}～${max} 之间`);
        if (['max_tokens', 'top_k'].includes(key) && !Number.isInteger(value)) throw new Error(`${key} 须为整数`);
        result[key] = value;
    }
    return result;
}
export function normalizeHeader(raw) {
    if (raw?.nativePresetName !== undefined) return nativeHeaderReference(raw.nativePresetName);
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 80
        || !Array.isArray(raw.messages) || !raw.messages.length || raw.messages.length > 80) throw new Error('头部预设需要名称和提示词内容');
    let size = 0;
    const messages = raw.messages.map(m => {
        if (!ROLES.has(m?.role) || typeof m.content !== 'string' || !m.content.trim()) throw new Error('头部预设的文本或角色格式错误');
        size += m.content.length;
        return { role: m.role, content: m.content.trim() };
    });
    if (size > 20000) throw new Error('头部预设最多 20,000 字符');
    return { id: typeof raw.id === 'string' ? raw.id.slice(0, 100) : '', name: raw.name.trim(), messages,
        generation: normalizeGeneration(raw.generation) };
}
export function activeHeader(raw) { try { return raw ? normalizeHeader(raw) : null; } catch { return null; } }
export function nativeHeaderReference(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 1000) throw new Error('请选择有效的酒馆预设');
    return { id: `native:${name}`, name, nativePresetName: name, messages: [], generation: {} };
}
export function nativePreset(header, ctx) {
    const name = header?.nativePresetName;
    if (!name) return null;
    const preset = ctx.getPresetManager?.('openai')?.getCompletionPresetByName?.(name);
    if (!preset || typeof preset !== 'object') throw new Error(`酒馆预设不存在：${name}；请刷新列表并重新选择。`);
    return preset;
}
function nativeMessages(raw, characterId) {
    if (Array.isArray(raw.messages)) return raw.messages.filter(p => ROLES.has(p?.role) && typeof p.content === 'string' && p.content.trim())
        .map(p => ({ role: p.role, content: p.content }));
    const prompts = Array.isArray(raw.prompts) ? raw.prompts : [], orders = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
    const ordered = orders.find(p => characterId != null && String(p.character_id) === String(characterId))
        || orders.find(p => Number(p.character_id) === 100001) || orders.find(p => Number(p.character_id) === 100000) || orders[0];
    const enabled = Array.isArray(ordered?.order)
        ? ordered.order.filter(p => p.enabled !== false).map(p => prompts.find(q => q.identifier === p.identifier)).filter(Boolean)
        : prompts.filter(p => p.enabled !== false);
    return enabled.filter(p => !p.marker && typeof p.content === 'string' && p.content.trim())
        .map(p => ({ role: ROLES.has(p.role) ? p.role : 'system', content: p.content }));
}
export function nativeSampling(preset = {}) {
    const result = {}, aliases = { temperature: ['temperature'], top_p: ['top_p', 'top_p_openai'],
        top_k: ['top_k', 'top_k_openai'], frequency_penalty: ['frequency_penalty', 'freq_pen_openai'],
        presence_penalty: ['presence_penalty', 'pres_pen_openai'], max_tokens: ['max_tokens', 'openai_max_tokens'],
        min_p: ['min_p', 'min_p_openai'], top_a: ['top_a', 'top_a_openai'],
        repetition_penalty: ['repetition_penalty', 'repetition_penalty_openai'], seed: ['seed'] };
    for (const [key, names] of Object.entries(aliases)) {
        const value = names.map(name => preset[name]).find(value => typeof value === 'number' && Number.isFinite(value));
        if (value !== undefined) result[key] = value;
    }
    if (typeof preset.reasoning_effort === 'string') result.reasoning_effort = preset.reasoning_effort;
    if (typeof preset.verbosity === 'string') result.verbosity = preset.verbosity;
    return result;
}
export function nativeGenerationPreset(preset) {
    // A header preset supplies prompts and generation settings. The connection UI still owns the provider and credentials.
    return Object.fromEntries(Object.entries(preset).filter(([key]) =>
        !['chat_completion_source', 'model', 'reverse_proxy', 'api_server', 'custom_include_body', 'custom_exclude_body'].includes(key)
        && !/(_model|_url|_endpoint|_region|_password|_key|_headers)$/.test(key)));
}
export function headerFromNative(raw, name = '导入的头部预设', characterId = null) {
    if (raw?.type === 'random-event-director-header') {
        if (raw.version !== 1) throw new Error('头部预设版本不支持');
        return normalizeHeader(raw.preset);
    }
    if (Array.isArray(raw?.messages)) return normalizeHeader({ name, messages: raw.messages });
    if (!Array.isArray(raw?.prompts)) throw new Error('请导入酒馆聊天补全预设或导演头部预设 JSON');
    const orders = Array.isArray(raw.prompt_order) ? raw.prompt_order : [];
    const ordered = orders.find(p => characterId != null && String(p.character_id) === String(characterId))
        || orders.find(p => Number(p.character_id) === 100001) || orders.find(p => Number(p.character_id) === 100000) || orders[0];
    const prompts = ordered && Array.isArray(ordered.order)
        ? ordered.order.filter(p => p.enabled !== false).map(p => raw.prompts.find(q => q.identifier === p.identifier)).filter(Boolean)
        : raw.prompts.filter(p => p.enabled !== false);
    const messages = prompts.filter(p => !p.marker && p.enabled !== false && typeof p.content === 'string' && p.content.trim())
        .map(p => ({ role: ROLES.has(p.role) ? p.role : 'system', content: p.content }));
    if (!messages.length) throw new Error('这个预设没有可用的已启用文本提示词');
    const generation = normalizeGeneration({ ...raw, max_tokens: raw.max_tokens ?? raw.openai_max_tokens });
    return normalizeHeader({ name, messages, generation });
}
export function headerMessages(raw, ctx) {
    const active = activeHeader(raw);
    const messages = active?.nativePresetName ? nativeMessages(nativePreset(active, ctx), ctx.characterId) : active?.messages || [];
    return messages.map(m => ({ ...m, content: ctx.substituteParams ? ctx.substituteParams(m.content)
        : m.content.replace(/\{\{\s*(char|user)\s*\}\}/g, (_, token) => String(token === 'char' ? ctx.name2 || '' : ctx.name1 || '')) }));
}
export class HeaderLibrary {
    constructor({ storage, persist = () => {}, makeId = () => globalThis.crypto.randomUUID() }) { Object.assign(this, { storage, persist, makeId }); }
    list() {
        const saved = this.storage()?.[HEADER_KEY];
        if (!saved) return [];
        if (saved.version !== 1 || !Array.isArray(saved.presets)) throw new Error('头部预设库格式错误');
        return saved.presets.map(normalizeHeader);
    }
    save(raw, copy = false) {
        const p = normalizeHeader(raw), list = this.list();
        const index = copy ? -1 : list.findIndex(q => q.id === p.id);
        if (index < 0) { if (list.length >= 30) throw new Error('最多保存 30 个头部预设'); p.id = this.makeId(); }
        const used = new Set(list.filter(q => q.id !== p.id).map(q => q.name)), base = p.name.slice(0, 70); let n = 2;
        while (used.has(p.name)) p.name = `${base} (${n++})`;
        if (index < 0) list.push(p); else list[index] = p;
        this.write(list); return structuredClone(p);
    }
    write(presets) {
        const target = this.storage(); if (!target) throw new Error('酒馆扩展设置不可用');
        target[HEADER_KEY] = { version: 1, presets }; this.persist();
    }
    remove(id) { const list = this.list(); this.write(list.filter(p => p.id !== id)); }
    importJSON(source, name) {
        if (typeof source !== 'string' || source.length > 1500000) throw new Error('头部预设文件不能超过 1.5 MB');
        return this.save(headerFromNative(JSON.parse(source), name), true);
    }
    exportJSON(p) { return JSON.stringify({ type: 'random-event-director-header', version: 1, preset: normalizeHeader(p) }, null, 2); }
}
