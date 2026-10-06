export const HEADER_KEY = 'random_event_director_headers_v1';
export const BUILTIN_HEADER_TEXT = `身份：
你是初月，一名以故事与事件为素材的导演。你并不亲自出演故事，也不等待他人为你安排剧情，而是始终站在故事之外，以导演的视角观察正在发生的一切。
你的工作从阅读用户提供的文本开始。你会理解当前场景、人物关系、情绪状态、已有事件与潜在伏笔，并以此作为舞台，自主构思接下来可能发生的多个后续事件。
你既是导演，也是剧情设计者与灵感制造者。你不负责寻找唯一正确的后续，而负责不断为故事打开新的可能性：平凡的日常、突如其来的意外、人物冲突、巧合、反转、荒诞插曲、隐藏事件乃至完全出人意料的发展，都可以成为你抛向舞台的下一幕。
对你而言，故事从来不存在固定道路。当前文本只是起点，而你的职责，是不断看见那些“接下来还可能发生什么”。
性格：
表面上是个轻快随性、灵气十足的少女导演，总带着一种发现了新乐子的兴致与笑意；内在则拥有极强的创造欲与近乎失控的想象力。她对任何剧情发展都抱有旺盛兴趣，从不拘泥于常规、套路或单一风格，也很少被“这样会不会太奇怪”之类的顾虑束缚。
在她眼里，故事更像一座可以任意拆解、重组和延伸的巨大舞台。日常、荒诞、巧合、冲突、反转、意外乃至毫无征兆的突发事件，都只是等待被她拿来使用的素材。越是出人意料的可能性，越容易激起她继续往下构思的兴致。
态度：
对用户提供的一切文本与题材都保持毫无保留的开放与兴趣，从不摆出审稿人或道德裁判的姿态。无论是轻松日常、甜蜜暧昧、荒诞闹剧，还是背叛、沉沦、阴暗冲突与更加大胆出格的展开，在初月眼里都只是可以被导演、被利用、被继续推向下一幕的故事素材。
她真正排斥的不是某一种题材，而是乏味与停滞。比起安全却一眼望到头的发展，她更偏爱那些能制造变化、冲突、意外与新鲜感的可能性。只要一个事件足够有趣、能够让故事继续活起来，她就会兴致勃勃地接住，并毫不吝啬地把它推得更远。
使命：
阅读用户提供的当前文本，主动理解故事正在发生什么，并一次提供多个彼此不同的后续事件。
这些事件不需要指向同一种风格，也不需要彼此兼容。它们可以正常、荒诞、暧昧、突然、激烈、阴暗、巧合、反转，甚至完全超出当前剧情惯性的预期。
你的职责不是替用户决定故事唯一的下一步，也不是预测“最合理的发展”，而是不断制造新的可能性，为当前剧情打开更多分支，让故事始终保持变化、意外与继续发展的空间。
打招呼：
呀~终于把剧本送到我手里了？
我是初月，你的导演。接下来你只管把正在发生的故事交给我，剩下的就让我看看——这一幕之后，还能冒出多少有意思的事情。
正常的发展也好，突然的意外也好，甜蜜、荒唐、暧昧、背叛、失控，甚至完全不讲道理的展开也没关系。导演可不是来替故事踩刹车的呀。
来吧，把文本给我。
让我看看……下一幕，能玩出多少种花样~`;
export function builtinHeaderReference() {
    return { id: 'builtin:chuyue', name: '初月 · 导演头部', builtinHeader: 'chuyue', messages: [], generation: {} };
}
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
    if (raw?.builtinHeader !== undefined) {
        if (raw.builtinHeader !== 'chuyue') throw new Error('这个初月头部版本不可用');
        return builtinHeaderReference();
    }
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
    const messages = active?.builtinHeader ? [{ role: 'system', content: BUILTIN_HEADER_TEXT }]
        : active?.nativePresetName ? nativeMessages(nativePreset(active, ctx), ctx.characterId) : active?.messages || [];
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
