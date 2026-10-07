import { placeEventInMessages } from './outgoing-injection.js';
import { stripOwnedInjection, requestGenerationType } from './request-isolation.js';
import { inspectPrompt } from './diagnostics.js';

const ownFolder = new URL('.', import.meta.url).pathname.split('/').filter(Boolean).at(-1);
const ownFolders = new Set([ownFolder, 'random-event-director', 'random-event-director-special']);
const MAX_BODY = 2000000;

// Only extension-relative locations leave this function. Never export a raw stack or URL.
export function callerEvidence(stack = '') {
    const plugins = [], frames = [];
    const normalized = String(stack).replaceAll('\\', '/');
    const pattern = /\/scripts\/extensions\/third-party\/([^\s/?#():]+)\/([^\s?#():]+\.m?js)(?::(\d+)(?::(\d+))?)?/g;
    for (const match of normalized.matchAll(pattern)) {
        let folder; try { folder = decodeURIComponent(match[1]); } catch { continue; }
        folder = folder.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
        if (!folder || ownFolders.has(folder)) continue;
        if (!plugins.includes(folder)) plugins.push(folder);
        const location = `${folder}/${match[2].slice(0, 160)}${match[3] ? ':' + match[3] : ''}${match[4] ? ':' + match[4] : ''}`;
        if (!frames.includes(location)) frames.push(location);
        if (frames.length >= 5) break;
    }
    return { sourceEvidence: plugins.length ? 'stack' : 'unknown', sourcePlugins: plugins.join(', ') || '未知', sourceFrames: frames.join('; ') };
}

export function forcePayload(payload, injection) {
    if (!payload || !injection || typeof payload !== 'object') return false;
    try {
        for (const key of ['messages', 'prompt']) {
            if (Array.isArray(payload[key])) {
                const result = placeEventInMessages(payload[key], injection, { mode: 'system' });
                if (result.changed) { payload[key] = result.messages; return true; }
                return false;
            }
        }
        if (typeof payload.prompt === 'string' && payload.prompt.length <= MAX_BODY) {
            const clean = { prompt: payload.prompt }; stripOwnedInjection(clean, injection);
            payload.prompt = `${injection}\n\n${clean.prompt}`; return true;
        }
    } catch { /* A diagnostic build must not break a request it cannot rewrite. */ }
    return false;
}

function endpointType(url) {
    let pathname; try { pathname = new URL(String(url), 'http://localhost').pathname; } catch { return null; }
    if (/\/api\/backends\/chat-completions\/generate\/?$/.test(pathname)) return 'chat-backend';
    if (/\/api\/backends\/(?:text-completions|kobold|koboldhorde|novel)\/generate\/?$/.test(pathname)) return 'text-backend';
    if (/\/chat\/completions\/?$/.test(pathname)) return 'chat-api';
    return null;
}
function safeModel(value) {
    const text = typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) : '未知';
    return /bearer|sk-|[?&=]|https?:/i.test(text) ? '已隐藏异常模型字段' : text;
}

// Observe the body's existing consumer. No clone, parallel reader, or unbounded SSE buffer.
export function observeResponse(response, finished) {
    let ended = false, content = false, failed = !response.ok, tail = '', structuredRead = 0;
    const decoder = new TextDecoder();
    const finish = ok => { if (ok && structuredRead) return; if (!ended) { ended = true; finished(ok && content && !failed); } };
    const data = value => {
        if (value?.error) failed = true;
        const choices = value?.choices || [];
        if (typeof value === 'string' && value.trim()) content = true;
        if (choices.some(c => c?.message?.content || c?.delta?.content || c?.text)
            || value?.content || value?.token || value?.text || value?.results?.some(r => r?.text)) content = true;
    };
    const chunk = value => {
        if (ended) return;
        const text = typeof value === 'string' ? value : value instanceof Uint8Array ? decoder.decode(value, { stream: true }) : '';
        if (!text) { if (value?.data) { try { data(JSON.parse(value.data)); } catch { /* Unknown SSE format. */ } } return; }
        tail += text;
        let newline;
        while ((newline = tail.indexOf('\n')) >= 0) {
            const line = tail.slice(0, newline).trim(); tail = tail.slice(newline + 1);
            if (line.startsWith('data:') && line !== 'data: [DONE]') {
                try { data(JSON.parse(line.slice(5).trim())); } catch { /* Incomplete/unsupported data. */ }
            }
        }
        if (tail.length > 8192) tail = ''; // Bounded observation; never retain whole responses.
    };
    for (const method of ['json', 'text']) {
        const original = response[method];
        if (typeof original !== 'function') continue;
        try { response[method] = function (...args) {
            structuredRead++;
            let result;
            try { result = original.apply(this, args); } catch (error) { structuredRead--; finish(false); throw error; }
            result.then(value => {
                structuredRead--;
                if (method === 'json') data(value);
                else { try { data(JSON.parse(value)); } catch { chunk(value); } }
                finish(true);
            }, () => { structuredRead--; finish(false); });
            return result;
        }; } catch { /* Frozen response: leave normal consumption intact. */ }
    }
    const body = response.body;
    if (!body) { finish(false); return response; }
    function watchReader(stream, inspect = true) {
        const getReader = stream?.getReader;
        if (typeof getReader !== 'function') return;
        try { stream.getReader = function (...args) {
        const reader = getReader.apply(this, args), read = reader.read, cancel = reader.cancel;
        reader.read = function (...values) {
            const result = read.apply(this, values);
            result.then(row => { if (row.done) finish(true); else if (inspect) chunk(row.value); }, () => finish(false));
            return result;
        };
        if (cancel) reader.cancel = function (...values) { finish(false); return cancel.apply(this, values); };
        reader.closed?.catch(() => finish(false));
        return reader;
        }; } catch { /* Read-only stream. */ }
    }
    watchReader(body);
    const through = body.pipeThrough, to = body.pipeTo;
    const observer = () => new TransformStream({ transform(value, controller) { chunk(value); controller.enqueue(value); }, flush() { finish(true); } });
    if (typeof through === 'function' && typeof TransformStream === 'function') try {
        body.pipeThrough = function (transform, options) {
            watchReader(transform?.readable, false);
            const observed = through.call(this, observer(), options);
            return observed.pipeThrough(transform, options);
        };
        if (typeof to === 'function') body.pipeTo = function (destination, options) {
            const result = through.call(this, observer(), options).pipeTo(destination, options);
            result.catch(() => finish(false)); return result;
        };
    } catch { /* Unsupported pipeline: retain event rather than assume success. */ }
    return response;
}

export function installRequestTrace({ context, getEvent, record, helperTrace, onTransport = () => {}, host = globalThis, now = Date.now }) {
    let disposed = false, sequence = 0, notification = 0;
    const active = new Set(), fingerprints = new Map(), secondarySignals = new WeakSet();
    const salt = globalThis.crypto?.randomUUID?.() || `${Math.random()}-${now()}`;
    const bus = context()?.eventSource, types = context()?.eventTypes || {};
    const watched = new Map(['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED']
        .filter(key => types[key]).map(key => [types[key], key]));
    const originalEmit = bus?.emit;
    const log = (stage, status, message, details, owner) => {
        try { record(stage, status, message, details, owner); } catch { /* Logging cannot affect host execution. */ }
    };
    const snapshotEvent = () => { try { return getEvent(); } catch { return null; } };
    const helperEvidence = stack => { try { return helperTrace?.evidence(stack) || {}; } catch { return {}; } };
    function wrappedEmit(name, ...args) {
        let helper = {};
        if (!disposed) { try { helper = helperTrace?.onEvent(name, args) || {}; } catch { /* Optional helper. */ } }
        if (!disposed && watched.has(name)) {
            const type = typeof args[0] === 'string' ? args[0] : args.find(value => typeof value === 'string');
            log('生成通知来源', 'info', '记录到酒馆生成通知；通知次数不等于实际 HTTP 请求次数。插件调用链仅为来源线索。',
                { notificationNumber: ++notification, notificationType: watched.get(name),
                    generationType: requestGenerationType({ type: type || null }) || 'unknown', ...callerEvidence(new Error().stack), ...helper });
        }
        return originalEmit.call(this, name, ...args);
    }
    if (typeof originalEmit === 'function') bus.emit = wrappedEmit;

    async function fingerprint(payload) {
        if (!globalThis.crypto?.subtle) return null;
        const input = JSON.stringify({ messages: payload.messages, prompt: payload.prompt,
            model: payload.model, source: payload.chat_completion_source });
        try {
            const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '\n' + input));
            return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        } catch { return null; }
    }
    const originalFetch = host.fetch;
    async function wrappedFetch(input, init) {
        const receiver = this || host;
        const forward = args => originalFetch.apply(receiver, args);
        const isRequest = input && typeof input === 'object' && typeof input.clone === 'function' && typeof input.url === 'string';
        const route = endpointType(isRequest ? input.url : input);
        const method = String(init?.method ?? (isRequest ? input.method : 'GET')).toUpperCase();
        if (disposed || !route || method !== 'POST') return forward([input, init]);
        const started = now(), requestNumber = ++sequence, requestId = `请求 ${requestNumber}`;
        const stack = new Error().stack;
        const evidence = { ...callerEvidence(stack), ...helperEvidence(stack) };
        const snapshot = snapshotEvent();
        let nextArgs = [input, init], details = { requestId, requestNumber, endpointType: route, ...evidence };
        let transportEvent = null;
        try {
            const bodyText = typeof init?.body === 'string' ? init.body
                : init?.body === undefined && isRequest ? await input.clone().text() : null;
            if (typeof bodyText !== 'string' || bodyText.length > MAX_BODY) throw new Error('unsupported');
            const payload = JSON.parse(bodyText);
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('unsupported');
            details.model = safeModel(payload.model);
            details.generationType = requestGenerationType(payload) || 'unknown';
            const signal = init?.signal ?? (isRequest ? input.signal : null);
            details.requestRole = signal && secondarySignals.has(signal) ? 'secondary'
                : ['quiet', 'impersonate'].includes(details.generationType) ? 'background'
                    : snapshot?.run ? 'foreground' : 'unknown';
            const identity = JSON.parse(bodyText);
            if (snapshot?.injection) stripOwnedInjection(identity, snapshot.injection);
            const hash = await fingerprint(identity);
            // Never place a newly selected card's event into an earlier card's asynchronous request.
            const current = snapshotEvent();
            const sameChat = Boolean(snapshot && current && snapshot.metadata === current.metadata && snapshot.owner === current.owner);
            const stableEvent = sameChat && snapshot?.injection === current?.injection;
            if (hash && sameChat) {
                const key = current.owner + ':' + hash, previous = fingerprints.get(key);
                if (previous && started - previous.time < 60000) {
                    details.samePayloadAs = previous.id; details.samePayloadCount = previous.count + 1;
                    log('重复发送线索', 'warn', '最近一分钟内相同生成内容再次发送。可能是重试或重新生成，不能仅凭此认定某个插件有问题。',
                        { ...details }, current.owner);
                }
                fingerprints.set(key, { id: requestId, time: started, count: details.samePayloadCount || 1 });
                if (fingerprints.size > 100) fingerprints.delete(fingerprints.keys().next().value);
            }
            details.forceInjection = Boolean(current?.enabled && current.forced && stableEvent && current.injection);
            details.injectionTarget = 'none';
            if (!disposed && details.forceInjection) {
                details.changed = forcePayload(payload, current.injection);
                details.eventPresent = inspectPrompt(payload, current.injection, current.event?.content).found;
                if (details.eventPresent) transportEvent = current;
                details.injectionTarget = Array.isArray(payload.messages) || Array.isArray(payload.prompt) ? 'system' : 'prompt-prefix';
                nextArgs = [input, { ...(init || {}), body: JSON.stringify(payload) }];
                log('实际请求强制注入', details.eventPresent ? 'success' : 'warn', details.eventPresent
                    ? '已将当前聊天的待用事件放入此实际生成请求。调用链中的插件是来源候选，不等于干扰者。'
                    : '请求格式或内容无法安全整理；不阻断请求，不虚报注入成功。', details, current.owner);
            } else log('实际生成请求', 'info', sameChat ? '记录实际发送：当前没有待用事件或强制模式未开启。'
                : '读取期间聊天或事件已切换，不把其他聊天的新事件加入此请求。', details, snapshot?.owner);
        } catch {
            log('实际请求检查', 'warn', '请求体格式不受支持，原样发送。未记录正文、URL、请求头或原始错误。', details, snapshot?.owner);
        }
        active.add(requestId);
        const transport = phase => { try { onTransport(transportEvent, phase, details); } catch { /* Optional lifecycle observer. */ } };
        transport('start');
        log('实际请求开始', 'info', '开始等待此请求的响应头；实际请求编号可与生成通知区分。', { ...details, activeRequests: active.size }, snapshot?.owner);
        try {
            const response = await forward(nextArgs);
            log('实际请求响应', response.ok ? 'success' : 'warn', '已收到响应头；这不等于流式正文完成，也不代表模型遵循事件。',
                { ...details, httpStatus: response.status, durationMs: Math.max(0, now() - started), outcome: 'response' }, snapshot?.owner);
            if (!response.ok) { active.delete(requestId); transport('failed'); return response; }
            const bodyFinished = ok => {
                active.delete(requestId);
                if (disposed) return;
                log('实际请求正文完成', ok ? 'success' : 'warn', ok ? '调用方已读取完整模型响应。正文完成与宿主通知分别记录。'
                    : '未确认有效正文完整返回；取消、错误或未知格式不会消费待用事件。',
                    { ...details, durationMs: Math.max(0, now() - started), outcome: ok ? 'complete' : 'incomplete', activeRequests: active.size }, snapshot?.owner);
                transport(ok ? 'complete' : 'failed');
            };
            try { return observeResponse(response, bodyFinished); }
            catch { bodyFinished(false); return response; }
        } catch (error) {
            log('实际请求失败', 'error', '请求未获得正常响应；保留原异常交给调用方处理，日志不记录错误原文。',
                { ...details, durationMs: Math.max(0, now() - started), outcome: error?.name === 'AbortError' ? 'aborted' : 'network-error' }, snapshot?.owner);
            active.delete(requestId); transport('failed'); throw error;
        }
    }
    if (typeof originalFetch === 'function') host.fetch = wrappedFetch;
    else log('传输层诊断', 'warn', '当前环境没有可观察的 fetch，仍使用酒馆请求钩子，无法记录实际 HTTP 发送。', {});
    return { markSecondary(signal) { if (signal && typeof signal === 'object') secondarySignals.add(signal); }, dispose() {
        disposed = true;
        if (host.fetch === wrappedFetch) host.fetch = originalFetch;
        if (bus?.emit === wrappedEmit) bus.emit = originalEmit;
        fingerprints.clear();
    } };
}
