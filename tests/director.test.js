import test from 'node:test';
import assert from 'node:assert/strict';
import { Director, KEY, DEFAULTS, randomInt, choose, parseEvents, poolPrompt, hiddenPrompt, uuid } from '../engine.js';
import { requestPool } from '../api.js';
import { install } from '../index.js';

const response = (n = 6, prefix = '') => JSON.stringify({ events: Array.from({ length: n }, (_, i) => ({
    id: `ai_${i}`, title: `${prefix}事件${i}`, content: `${prefix}门外出现情境${i}。`, type: 'daily', weight: i + 1 })) });
function fixture(options = {}) {
    let ids = 0, requests = 0, saves = 0, randomCalls = 0, prompt = '', time = 100000;
    const logs = [], queue = [];
    let ctx = { characterId: 0, characters: [{ avatar: 'a.png', description: '旅馆世界', personality: '稳重' }],
        chatId: 'A', chatMetadata: {}, chat: [{ is_user: true, name: '玩家', mes: '我坐在旅馆里。' }] };
    const d = new Director({ context: () => ctx, request: async (...args) => { requests++; return options.request ? options.request(...args) : response(); },
        inject: p => { prompt = p; }, persist: () => { saves++; }, log: (...args) => logs.push(args),
        rng: max => { randomCalls++; return options.rng ? options.rng(max) : 0; }, makeId: () => `local_${++ids}`,
        now: () => time, defer: fn => queue.push(fn) });
    const state = d.state(); state.enabled = true; state.triggerProbability = 100;
    return { d, state, logs, queue, get ctx() { return ctx; }, set ctx(value) { ctx = value; },
        get requests() { return requests; }, get saves() { return saves; }, get randomCalls() { return randomCalls; }, get prompt() { return prompt; },
        time: delta => { time += delta; }, flush: async () => { for (const fn of queue.splice(0)) fn(); await new Promise(r => setImmediate(r)); } };
}
function reply(f, text = '门外忽然响起三声敲门声。', type = 'normal') {
    const m = { is_user: false, mes: text, gen_finished: new Date().toISOString() };
    f.ctx.chat.push(m); f.d.receive(f.ctx.chat.length - 1, type); return m;
}
async function prepare(f) { assert.equal(await f.d.refill(), true); }

test('默认值与副 AI 结构化输出：6 个事件，去重、本地 ID、非法 JSON 拒绝', () => {
    assert.equal(DEFAULTS.triggerProbability, 25); assert.equal(DEFAULTS.targetCount, 6); assert.equal(DEFAULTS.expiryTurns, 7);
    const events = parseEvents('```json\n' + response() + '\n```', 6);
    assert.equal(events.length, 6); assert.equal(new Set(events.map(e => e.id)).size, 6);
    assert.ok(events.every(e => !e.id.startsWith('ai_') && e.status === 'available'));
    assert.throws(() => parseEvents('not JSON', 6));
    assert.throws(() => parseEvents('{"events":[{"title":"","content":""}]}', 6));
    assert.equal(parseEvents('{"events":[{"title":"a","content":"b"},{"title":"c","content":"b"}]}', 6).length, 1);
});
test('crypto 拒绝采样与加权选择边界；无 crypto 时不偷偷退化', () => {
    const values = [4294967295, 7];
    assert.equal(randomInt(10, { getRandomValues: a => { a[0] = values.shift(); } }), 7);
    assert.throws(() => randomInt(10, {}));
    const events = [{ title: 'a', weight: 1 }, { title: 'b', weight: 3 }];
    assert.equal(choose(events, () => 0).title, 'a'); assert.equal(choose(events, () => 1).title, 'b');
    assert.equal(choose(events, () => 3).title, 'b'); assert.equal(choose([]), null);
});
test('局域网 HTTP 缺少 randomUUID 时仍使用 crypto 生成稳定本地 ID', () => {
    assert.match(uuid({ getRandomValues: a => a.fill(1) }), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});
test('副 AI 读取受限近期剧情、角色背景及补充设定；不请求选择事件', () => {
    const f = fixture(); f.ctx.chat = Array.from({ length: 40 }, (_, i) => ({ mes: `剧情${i}`, is_user: i % 2 === 0 }));
    f.state.contextMessages = 16; f.state.worldNotes = '不可出现手机';
    const messages = poolPrompt(f.ctx, f.state, 6), data = JSON.parse(messages[1].content);
    assert.equal(data.recent_story.length, 16); assert.equal(data.recent_story[0].text, '剧情24');
    assert.match(data.background, /不可出现手机/); assert.match(messages[0].content, /不随机选事件/);
});
test('完整链路：一次副 AI、两层本地随机、隐藏注入、成功消费', async () => {
    const f = fixture(); await prepare(f);
    const oldText = f.ctx.chat[0].mes;
    f.d.start('normal'); f.d.intercept('normal');
    assert.equal(f.state.eventPool.length, 5); assert.equal(f.state.pendingEvent.event.status, 'pending');
    assert.equal(f.randomCalls, 2); assert.match(f.prompt, /private scene direction/);
    assert.equal(f.ctx.chat.length, 1); assert.equal(f.ctx.chat[0].mes, oldText);
    reply(f); f.d.end(); await f.flush();
    assert.equal(f.state.pendingEvent, null); assert.equal(f.state.recentEvent.status, 'consumed');
    assert.equal(f.requests, 1); assert.equal(f.prompt, ''); assert.ok(f.saves > 0);
});
test('关闭后不调用副 AI、不随机、不注入；手动按钮也无效', async () => {
    const f = fixture(); f.d.update({ enabled: false });
    f.d.start('normal'); f.d.intercept('normal'); reply(f); f.d.end(); await f.flush();
    assert.equal(await f.d.rollNow(), false); assert.equal(await f.d.refill(true), false);
    assert.equal(f.requests, 0); assert.equal(f.randomCalls, 0); assert.equal(f.prompt, '');
});
test('0% 判定与未触发结果在 regenerate 中保持不变', async () => {
    const f = fixture(); await prepare(f); f.state.triggerProbability = 0;
    f.d.start('normal'); f.d.intercept('normal'); reply(f); f.d.end();
    assert.equal(f.prompt, ''); assert.equal(f.state.recentEvent, null);
    f.state.triggerProbability = 100; const calls = f.randomCalls;
    f.d.start('regenerate'); f.ctx.chat.pop(); f.d.intercept('regenerate');
    assert.equal(f.prompt, ''); assert.equal(f.randomCalls, calls); assert.equal(f.state.eventPool.length, 6);
});
test('成功后 regenerate / swipe / continue 都复用原事件且只消费一次', async () => {
    const f = fixture(); await prepare(f); f.d.start('normal'); f.d.intercept('normal'); const original = f.prompt;
    reply(f); f.d.end(); const calls = f.randomCalls;
    for (const type of ['regenerate', 'swipe', 'continue']) {
        f.d.start(type);
        if (type === 'regenerate') { f.ctx.chat.pop(); f.d.invalidate('delete', f.ctx.chat.length); }
        f.d.intercept(type); assert.equal(f.prompt, original);
        reply(f, '门外敲门声再次传来。', type); f.d.end();
    }
    assert.equal(f.randomCalls, calls); assert.equal(f.state.eventPool.length, 5);
});
test('中止和失败（含流式部分文本）不消费，重试仍用 pending', async () => {
    for (const failure of ['stop', 'stream-error', 'aborted-stream', 'empty']) {
        const f = fixture(); await prepare(f); f.d.start('normal'); f.d.intercept('normal'); const original = f.prompt;
        if (failure === 'stop') f.d.stop();
        if (failure === 'stream-error') f.ctx.streamingProcessor = { isStopped: true };
        if (failure === 'aborted-stream') f.ctx.streamingProcessor = { abortController: { signal: { aborted: true } } };
        reply(f, failure === 'empty' ? '' : '部分文本'); f.d.end();
        assert.equal(f.state.pendingEvent.event.status, 'pending'); assert.equal(f.state.recentEvent, null);
        f.ctx.streamingProcessor = null; f.d.start('regenerate'); f.ctx.chat.pop(); f.d.intercept('regenerate');
        assert.equal(f.prompt, original); reply(f); assert.equal(f.state.pendingEvent, null);
    }
});
test('GENERATION_ENDED 不当作成功；副 AI/冒充生成/dry run 不掷骰', async () => {
    const f = fixture(); await prepare(f);
    for (const type of ['quiet', 'impersonate', 'first_message']) { f.d.start(type); f.d.intercept(type); f.d.end(); }
    f.d.start('normal', {}, true); assert.equal(f.randomCalls, 0);
    f.d.start('normal'); f.d.intercept('normal'); f.d.end();
    assert.ok(f.state.pendingEvent); assert.equal(f.state.recentEvent, null);
});
test('空池正常生成不等待副 AI，即使副 AI 无限挂起', async () => {
    const f = fixture({ request: (_ctx, _msgs, _s, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    const fill = f.d.refill(); f.d.start('normal');
    assert.equal(f.d.intercept('normal'), undefined); assert.equal(f.prompt, '');
    reply(f); f.d.update({ enabled: false }); assert.equal(await fill, false);
});
test('JSON 错误安全跳过、记录错误、自动补池不会每轮重试', async () => {
    const f = fixture({ request: async () => '错误输出' });
    assert.equal(await f.d.refill(), false); assert.ok(f.state.error); assert.equal(f.requests, 1);
    f.d.start('normal'); f.d.intercept('normal'); reply(f); f.d.end(); await f.flush();
    assert.equal(f.requests, 1); assert.equal(f.prompt, '');
});
test('副 AI 请求失败安全返回', async () => {
    const f = fixture({ request: async () => { throw new Error('provider unavailable'); } });
    assert.equal(await f.d.refill(), false); assert.match(f.state.error, /provider unavailable/);
});
test('副 AI 超时有界，中止请求，不阻塞主生成', async () => {
    const f = fixture({ request: async () => new Promise(() => {}) }); f.state.timeoutSeconds = 5;
    const pending = f.d.refill(); f.d.start('normal'); f.d.intercept('normal'); reply(f);
    assert.equal(await pending, false); assert.match(f.state.error, /超时/); assert.equal(f.d.fill, null);
});
test('手动掷骰可先生成空池，不生成主聊天消息，下一轮使用', async () => {
    const f = fixture(); f.state.triggerProbability = 0;
    assert.equal(await f.d.rollNow(), true); assert.equal(f.ctx.chat.length, 1); assert.equal(f.prompt, '');
    const event = f.state.pendingEvent.event.id, calls = f.randomCalls;
    assert.equal(await f.d.rollNow(), true); assert.equal(f.randomCalls, calls);
    f.d.start('normal'); f.d.intercept('normal'); assert.match(f.prompt, /门外/);
    assert.equal(f.state.pendingEvent.event.id, event); reply(f); assert.equal(f.state.pendingEvent, null);
});
test('补充阈值只在低库存后后台补池；事件池按 7 回合过期', async () => {
    let batch = 0;
    const f = fixture({ request: async () => response(6, `批次${++batch}`) }); await prepare(f);
    for (let i = 0; i < 4; i++) {
        if (i) f.ctx.chat.push({ is_user: true, mes: `行动${i}` });
        f.d.start('normal'); f.d.intercept('normal'); reply(f); f.d.end();
    }
    assert.equal(f.state.eventPool.length, 2); f.time(31000);
    assert.equal(await f.d.refill(), true); assert.equal(f.requests, 2); assert.equal(f.state.eventPool.length, 6);
    f.ctx.chat.push(...Array.from({ length: 3 }, () => ({ mes: '过了一轮', is_user: false })));
    f.ctx.chat.push({ is_user: true, mes: '继续' }); f.d.start('normal'); f.d.intercept('normal');
    assert.equal(f.state.eventPool.length, 0); assert.equal(f.prompt, '');
});
test('重新生成池保留 pending，失败保留原池', async () => {
    let prefix = ''; const f = fixture({ request: async () => prefix === 'fail' ? 'invalid' : response(6, prefix) });
    await prepare(f); await f.d.rollNow(); const pending = f.state.pendingEvent.event.id;
    prefix = 'new'; assert.equal(await f.d.refill(true), true); assert.equal(f.state.pendingEvent.event.id, pending);
    assert.equal(f.state.eventPool.length, 6); assert.ok(f.state.eventPool.every(e => e.title.startsWith('new')));
    prefix = 'fail'; assert.equal(await f.d.refill(true), false); assert.equal(f.state.eventPool.length, 6);
});
test('聊天切换、分支、迟到副 AI 结果与主回复隔离', async () => {
    let resolve; const f = fixture({ request: async () => new Promise(r => { resolve = r; }) });
    const pending = f.d.refill(); const old = f.ctx;
    f.ctx = { ...old, chatId: 'B', chat: [{ is_user: true, mes: '另一个故事' }], chatMetadata: {} }; f.d.switchChat();
    resolve(response()); assert.equal(await pending, false); assert.equal(f.d.state().eventPool.length, 0); assert.equal(f.prompt, '');
    f.ctx = old; f.d.switchChat(); assert.equal(f.state.eventPool.length, 0);
    const copied = JSON.parse(JSON.stringify(old.chatMetadata));
    f.ctx = { ...old, chatId: 'branch', chatMetadata: copied }; f.d.switchChat();
    assert.equal(f.d.state().eventPool.length, 0); assert.equal(f.d.state().pendingEvent, null);
});
test('旧聊天主生成不能消费新聊天事件', async () => {
    const f = fixture(); await prepare(f); f.d.start('normal'); f.d.intercept('normal'); const a = f.state;
    f.ctx = { ...f.ctx, chatId: 'B', chatMetadata: {}, chat: [{ mes: '新聊天', is_user: true }] };
    const b = f.d.state(); b.enabled = true; reply(f);
    assert.ok(a.pendingEvent); assert.equal(b.recentEvent, null);
});
test('刷新后 pending、成功历史、未触发结果可恢复', async () => {
    const f = fixture(); await prepare(f); f.d.start('normal'); f.d.intercept('normal'); const original = f.prompt;
    f.ctx = JSON.parse(JSON.stringify(f.ctx));
    f.d.start('normal'); f.d.intercept('normal'); assert.equal(f.prompt, original); reply(f);
    f.ctx = JSON.parse(JSON.stringify(f.ctx));
    f.d.start('regenerate'); f.ctx.chat.pop(); f.d.intercept('regenerate'); assert.equal(f.prompt, original);
});
test('消息编辑/删除/swipe 清理过期池，保留有效重放决策', async () => {
    const f = fixture(); await prepare(f); await f.d.rollNow(); f.d.start('normal'); f.d.intercept('normal'); reply(f); f.d.end();
    const key = f.ctx.chat[0].extra[KEY].anchorId;
    f.d.invalidate('swipe', 1); assert.equal(f.state.eventPool.length, 0); assert.ok(f.state.cycles[key]);
    f.d.invalidate('edit', 0); assert.equal(f.state.cycles[key], undefined);
    f.ctx.chat = []; f.d.invalidate('delete', 0); assert.equal(f.state.pendingEvent, null);
});
test('群聊同一用户回合只投放一次，swipe 重放不再消费', async () => {
    const f = fixture(); f.ctx.groupId = 'group1'; const state = f.d.state(); state.enabled = true; state.triggerProbability = 100;
    await prepare(f); f.d.start('normal'); f.d.intercept('normal'); const prompt = f.prompt; reply(f); f.d.end();
    f.d.start('normal'); f.d.intercept('normal'); assert.equal(f.prompt, ''); reply(f); f.d.end();
    f.d.start('swipe'); f.d.intercept('swipe'); assert.equal(f.prompt, ''); f.d.end();
    f.ctx.chat.pop(); // Return to the first member's response, which actually received the event.
    f.d.start('swipe'); f.d.intercept('swipe'); assert.equal(f.prompt, prompt); assert.equal(state.eventPool.length, 5);
});
test('副 AI API 复用配置，独立模型覆盖与 AbortSignal 原样传递', async () => {
    const captured = [], signal = new AbortController().signal;
    const ctx = { mainApi: 'openai', chatCompletionSettings: { model: 'main-model' }, ChatCompletionService: {
        presetToGeneratePayload: async (...args) => { captured.push(args); return args[2]; },
        sendRequest: async (...args) => { captured.push(args); return { content: response() }; } } };
    await requestPool(ctx, [{ role: 'user', content: '剧情' }], { useCurrentModel: false, model: 'secondary' }, signal);
    assert.equal(captured[0][2].model, 'secondary'); assert.equal(captured[0][2].stream, false);
    assert.equal(captured[1][2], signal); assert.equal(ctx.chatCompletionSettings.model, 'main-model');
    await requestPool(ctx, [], { useCurrentModel: true }, signal);
    assert.equal(captured[2][2].model, undefined);
    await assert.rejects(requestPool({ mainApi: 'kobold' }, [], { useCurrentModel: true }, signal));
});
test('Text Completion 复用酒馆服务；未设置副模型时明确失败', async () => {
    const signal = new AbortController().signal;
    const ctx = { mainApi: 'textgenerationwebui', TextCompletionService: {
        presetToGeneratePayload: (_p, _o, payload) => { assert.match(payload.prompt, /SYSTEM/); return payload; },
        sendRequest: async () => ({ content: response() }) } };
    assert.equal(await requestPool(ctx, [{ role: 'system', content: '规则' }], { useCurrentModel: true }, signal), response());
    await assert.rejects(requestPool(ctx, [], { useCurrentModel: false, model: '' }, signal));
});
test('Extension 加载、生成事件接线、重复安装和卸载不重复监听', () => {
    const handlers = new Map(); let hidden = '';
    const ctx = { setExtensionPrompt(_key, text) { hidden = text; }, saveMetadata() {}, chat: [{ is_user: true, mes: '门内聊天' }], chatId: 'A', characterId: 0, chatMetadata: {},
        eventSource: { on: (key, fn) => { const list = handlers.get(key) || []; list.push(fn); handlers.set(key, list); },
            removeListener: (key, fn) => handlers.set(key, (handlers.get(key) || []).filter(x => x !== fn)) },
        eventTypes: Object.fromEntries(['APP_READY','CHAT_CHANGED','CHAT_LOADED','GENERATION_STARTED','GENERATION_STOPPED','GENERATION_ENDED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','MESSAGE_SWIPE_DELETED','CHAT_RENAMED'].map(k => [k, k])) };
    const host = { getContext: () => ctx }, doc = { querySelector: () => null };
    const first = install(host, doc); const second = install(host, doc);
    assert.equal(first.director.disposed, true); assert.equal(handlers.get('GENERATION_STARTED').length, 1);
    assert.doesNotThrow(() => globalThis.randomEventDirectorInterceptor([], 10000, () => assert.fail('must never abort'), 'normal'));
    const state = second.director.state(); state.enabled = true; state.triggerProbability = 100; state.eventPool = parseEvents(response(), 6);
    handlers.get('GENERATION_STARTED')[0]('normal', {}, false);
    globalThis.randomEventDirectorInterceptor([], 10000, () => assert.fail('must never abort'), 'normal');
    assert.match(hidden, /private scene direction/); assert.equal(ctx.chat[0].mes, '门内聊天');
    ctx.chat.push({ is_user: false, mes: '门外一声响动。', gen_finished: 'done' });
    handlers.get('MESSAGE_RECEIVED')[0](1, 'normal'); assert.equal(state.pendingEvent, null); assert.equal(hidden, '');
    state.eventPool = 'corrupt';
    assert.doesNotThrow(() => handlers.get('GENERATION_STARTED')[0]('normal', {}, false));
    assert.doesNotThrow(() => globalThis.randomEventDirectorInterceptor([], 10000, () => assert.fail('must never abort'), 'normal'));
    assert.equal(hidden, '');
    second.dispose(); assert.ok([...handlers.values()].every(a => a.length === 0));
    assert.equal(globalThis.randomEventDirectorInterceptor, undefined);
});
test('状态读取错误与本地随机异常不逃逸到酒馆生成链', async () => {
    const f = fixture(); f.state.eventPool = 'corrupt'; assert.throws(() => f.d.state());
    assert.doesNotThrow(() => f.d.fail(new Error('读取失败')));
    assert.equal(await f.d.refill(), false);
    assert.match(hiddenPrompt({ content: '门响了。' }), /Do not decide or force the user's character/);
});
