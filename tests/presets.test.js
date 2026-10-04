import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, KEY, hiddenPrompt, poolPrompt } from '../engine.js';
import { PresetLibrary, DEFAULT_PRESET, LIBRARY_KEY, normalizePreset, renderTemplate } from '../presets.js';
import { requestPool, completionPresets } from '../api.js';

const custom = (name = '旅馆日常') => ({ ...DEFAULT_PRESET, id: 'custom', name,
    generatorPrompt: '为 {{char}} 与 {{user}} 的日常生成 {{count}} 个轻松事件。',
    injectionTemplate: '日常演出：{{title}}\n情境：{{event}}\n类型：{{type}}\n保留 {{char}} 的人格。', completionPresetName: '' });
function library() {
    const storage = {}; let id = 0, saves = 0;
    const lib = new PresetLibrary({ storage: () => storage, persist: () => saves++, makeId: () => `preset-${++id}` });
    return { lib, storage, get saves() { return saves; } };
}
function engine() {
    let id = 0, prompt = '', requests = 0, resolve;
    let ctx = { characterId: 0, characters: [{ avatar: 'hotel.png' }], chatId: 'A', chatMetadata: {},
        name1: '玩家', name2: '旅馆老板', chat: [{ is_user: true, mes: '我们在旅馆聊天。' }] };
    const d = new Director({ context: () => ctx, request: async () => { requests++; return new Promise(r => { resolve = r; }); },
        inject: text => { prompt = text; }, persist: () => {}, changed: () => {}, log: () => {}, makeId: () => `anchor-${++id}`, rng: () => 0, defer: () => {} });
    const s = d.state(); s.enabled = true; s.triggerProbability = 100;
    const add = () => s.eventPool.push({ id: `event-${++id}`, title: '敲门', content: '门外传来三声敲门声。', type: 'daily', weight: 10, status: 'available' });
    return { d, s, add, get prompt() { return prompt; }, get ctx() { return ctx; }, set ctx(value) { ctx = value; },
        get requests() { return requests; }, finishFill: () => resolve('{"events":[{"title":"新事件","content":"前台送来一封信。"}]}') };
}

test('旧聊天迁移到默认预设，默认提示词保持原来的事件行为', () => {
    const f = engine(); assert.equal(f.s.directorPreset.id, DEFAULT_PRESET.id);
    assert.match(poolPrompt(f.ctx, f.s, 6)[0].content, /生成 6 个/);
    assert.match(hiddenPrompt({ content: '有人敲门。' }), /private scene direction/);
});
test('预设库保存、改名、另存、删除默认保护、全局序列化恢复', () => {
    const f = library(); const first = f.lib.save(custom()); assert.equal(f.saves, 1);
    assert.equal(f.lib.list().length, 2);
    const changed = f.lib.save({ ...first, name: '乡间日常' }); assert.equal(changed.id, first.id);
    const copy = f.lib.save(changed, true); assert.notEqual(copy.id, first.id); assert.equal(copy.name, '乡间日常 (2)');
    assert.throws(() => f.lib.remove(DEFAULT_PRESET.id));
    const restored = new PresetLibrary({ storage: () => JSON.parse(JSON.stringify(f.storage)) });
    assert.equal(restored.list().length, 3); f.lib.remove(first.id); assert.equal(f.lib.list().length, 2);
});
test('导入导出完整提示词；同名只新增且不覆盖，非法批次原子拒绝', () => {
    const f = library(); const p = f.lib.save(custom()); const exported = f.lib.exportJSON(p);
    const added = f.lib.importJSON(exported); assert.notEqual(added[0].id, p.id); assert.equal(added[0].name, '旅馆日常 (2)');
    assert.equal(added[0].injectionTemplate, p.injectionTemplate);
    const before = JSON.stringify(f.storage), batch = JSON.parse(exported); batch.presets.push({ name: '坏预设' });
    assert.throws(() => f.lib.importJSON(JSON.stringify(batch))); assert.equal(JSON.stringify(f.storage), before);
    assert.throws(() => f.lib.importJSON('{"type":"SillyTavern","version":1,"presets":[]}'));
    assert.equal(JSON.parse(f.lib.exportJSON()).presets.length, 2);
});
test('模板校验与占位符是单次字面替换；固定 JSON / 隐藏演出规则保留', () => {
    assert.throws(() => normalizePreset({ ...custom(), generatorPrompt: '忘记数量' }));
    assert.throws(() => normalizePreset({ ...custom(), injectionTemplate: '缺少事件' }));
    assert.throws(() => normalizePreset({ ...custom(), generatorPrompt: '{{count}} {{unknown}}' }));
    const event = { title: '敲门', type: 'daily', content: '$& $` {{title}}' };
    assert.equal(renderTemplate('{{event}}', { event: event.content }), event.content);
    assert.match(hiddenPrompt(event, custom()), /\$& \$` \{\{title\}\}/);
    assert.match(hiddenPrompt(event, custom()), /固定演出规则/);
    const f = engine(); f.s.directorPreset = custom();
    const system = poolPrompt(f.ctx, f.s, 4)[0].content;
    assert.match(system, /旅馆老板 与 玩家.*4/); assert.match(system, /固定输出协议/);
});
test('应用预设清空旧可用池、聊天隔离、刷新保留独立快照', () => {
    const f = engine(); f.s.enabled = false; f.add(); f.d.applyPreset(custom());
    assert.equal(f.s.eventPool.length, 0); assert.equal(f.s.directorPreset.name, '旅馆日常');
    f.ctx = JSON.parse(JSON.stringify(f.ctx)); assert.equal(f.d.state().directorPreset.name, '旅馆日常');
    f.ctx = { ...f.ctx, chatId: 'B', chatMetadata: {}, chat: [] }; f.d.switchChat();
    assert.equal(f.d.state().directorPreset.id, DEFAULT_PRESET.id);
});
test('切换预设不改本轮已消费事件的隐藏模板，regenerate 原样重放', () => {
    const f = engine(); f.add(); f.d.start('normal'); f.d.intercept('normal'); const original = f.prompt;
    f.ctx.chat.push({ is_user: false, mes: '门响了。', gen_finished: 'done' }); f.d.receive(1, 'normal'); f.d.end();
    f.s.enabled = false; f.d.applyPreset(custom()); f.s.enabled = true;
    f.d.start('regenerate'); f.ctx.chat.pop(); f.d.intercept('regenerate'); assert.equal(f.prompt, original);
    assert.equal(f.s.eventPool.length, 0);
});
test('手动 pending 保留选择时的注入模板，切换预设后下一轮仍用原模板', async () => {
    const f = engine(); f.add(); await f.d.rollNow(); const prepared = f.s.pendingEvent.injection;
    f.s.enabled = false; f.d.applyPreset(custom()); f.s.enabled = true;
    f.d.start('normal'); f.d.intercept('normal'); assert.equal(f.prompt, prepared);
    assert.equal(f.s.cycles[f.s.pendingEvent.cycleKey].injection, prepared);
});
test('预设切换取消旧副请求并丢弃迟到结果；主生成期间应用被拒绝', async () => {
    const f = engine(); const fill = f.d.refill(); f.s.enabled = false; f.d.applyPreset(custom()); f.finishFill();
    assert.equal(await fill, false); assert.equal(f.s.eventPool.length, 0);
    f.d.start('normal'); assert.throws(() => f.d.applyPreset(DEFAULT_PRESET));
});
test('原生参数预设列表兼容数组和映射，不切换主预设且不修改预设对象', async () => {
    const preset = { temperature: 0.3, top_p: 0.8 }, calls = [];
    const ctx = { mainApi: 'openai', getPresetManager: () => ({ getPresetList: () => ({ preset_names: { '日常参数': 0 } }),
        getCompletionPresetByName: name => name === '日常参数' ? preset : undefined }), ChatCompletionService: {
        presetToGeneratePayload: async (p, _o, override) => { calls.push([p, override]); p.temperature = 0.4; return { ...p, ...override }; },
        sendRequest: async payload => { calls.push(payload); return { content: 'JSON' }; } } };
    assert.deepEqual(completionPresets(ctx), ['日常参数']);
    assert.deepEqual(completionPresets({ mainApi: 'openai', getPresetManager: () => ({ getPresetList: () => ({ preset_names: ['B', 'A'] }) }) }), ['A', 'B']);
    await requestPool(ctx, [], { useCurrentModel: true, directorPreset: { completionPresetName: '日常参数' } }, new AbortController().signal);
    assert.equal(calls[0][1].temperature, undefined); assert.equal(calls[1].stream, false); assert.equal(preset.temperature, 0.3);
    await assert.rejects(requestPool(ctx, [], { useCurrentModel: true, directorPreset: { completionPresetName: 'missing' } }, new AbortController().signal), /预设不存在/);
});
test('删除全局预设不影响当前聊天快照，修改库不自动修改其他聊天', () => {
    const f = library(), saved = f.lib.save(custom()), e = engine(); e.s.enabled = false; e.d.applyPreset(saved);
    f.lib.save({ ...saved, injectionTemplate: '新模板：{{event}}' });
    assert.equal(e.s.directorPreset.injectionTemplate, saved.injectionTemplate);
    f.lib.remove(saved.id); assert.equal(e.s.directorPreset.id, saved.id);
    assert.equal(e.ctx.chatMetadata[KEY].directorPreset.name, saved.name);
    assert.equal(f.storage[LIBRARY_KEY].presets.length, 0);
});
