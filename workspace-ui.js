import { mountDiagnosticsUI } from './diagnostics-ui.js';
import { makeDraggable, placeWidget, visibleViewport } from './window-placement.js';
import { PERSONAS, PERSONA_PREFERENCES_KEY, discussionPersona, normalizePersona } from './personas.js';
import { mountUpdateUI } from './update-ui.js';
import { CURRENT_VERSION } from './updates.js';

const WORKSPACE_KEY = 'random_event_director_workspace_ui_v1';
const WINDOW_SIZES = new Set(['small', 'medium', 'large']);
// A faceted D10 silhouette, not a six-sided pip die. Decorative faces do not represent an event probability roll.
const D10 = `<svg class="red-d10" viewBox="0 0 100 108" aria-hidden="true" focusable="false"><path class="red-die-shadow" d="M50 7 89 38 79 76 50 100 21 76 11 38Z"/><path class="red-die-face red-die-face-top" d="M50 7 11 38 50 29 89 38Z"/><path class="red-die-face red-die-face-left" d="M11 38 21 76 37 63 50 29Z"/><path class="red-die-face red-die-face-center" d="M50 29 37 63 50 89 63 63Z"/><path class="red-die-face red-die-face-right" d="M89 38 79 76 63 63 50 29Z"/><path class="red-die-face red-die-face-bottom" d="M21 76 50 100 79 76 63 63 50 89 37 63Z"/><path class="red-die-edges" d="M50 7 89 38 79 76 50 100 21 76 11 38Z M11 38 50 29 89 38 M50 7V29 M50 29 37 63 21 76 M50 29 63 63 79 76 M37 63 50 89 63 63 M50 89V100"/><text class="red-die-number" x="50" y="64" text-anchor="middle">10</text><path class="red-die-glint" d="M46 17h8 M50 13v8"/></svg>`;

export function mountWorkspace(director, context, settings, settingsHost, doc = document) {
    doc.querySelector('#red_director_window')?.remove(); doc.querySelector('#red_director_entry')?.remove();
    doc.querySelector('#red_director_dice_dock')?.remove();
    doc.querySelector('#red_director_event_window')?.remove();
    const window = doc.createElement('section');
    window.id = 'red_director_window'; window.className = 'red-window'; window.hidden = true;
    window.setAttribute('role', 'dialog'); window.setAttribute('aria-label', '导演系统-初月');
    window.innerHTML = `<header class="red-window-head"><div class="red-window-title"><span class="red-moon" aria-hidden="true">☾</span><div><strong>导演系统-初月</strong><small>先聊想法，再决定下一幕</small></div></div>
      <div class="red-window-tools"><div class="red-size-switch" role="group" aria-label="窗口大小"><button type="button" data-size="large" aria-label="大窗口" aria-pressed="false">大</button><button type="button" data-size="medium" aria-label="中窗口" aria-pressed="true">中</button><button type="button" data-size="small" aria-label="小窗口" aria-pressed="false">小</button></div><button type="button" data-window="maximize" aria-label="放大窗口" title="放大 / 还原">⛶</button><button type="button" data-window="close" aria-label="关闭导演窗口" title="关闭">×</button></div></header>
      <nav class="red-tabs" aria-label="导演系统页面"><button type="button" data-view="chat" aria-pressed="true">剧情讨论</button><button type="button" data-view="events" aria-pressed="false">随机事件</button><button type="button" data-view="pool" aria-pressed="false">事件池</button><button type="button" data-view="settings" aria-pressed="false">设置</button><button type="button" data-view="logs" aria-pressed="false">诊断日志</button></nav><div class="red-owner" data-window-role="owner"></div>
      <div class="red-chat-view" data-page="chat"><div class="red-persona-chatbar"><small data-window-role="persona-hint"></small><label>聊天人设 <select data-window-role="persona" aria-label="小窗聊天人设"></select></label></div><div class="red-guide-status" data-window-role="guide-status"></div>
        <div class="red-transcript" data-window-role="messages" role="log" aria-label="导演讨论记录" aria-live="polite"></div>
        <div class="red-proposal" data-window-role="proposal" hidden><div class="red-summary-card"><strong><span aria-hidden="true">✧</span> 本次方向总结</strong><p data-window-role="summary"></p></div><div class="red-window-actions"><button type="button" data-window="accept">应用到下一次事件</button><button type="button" data-window="reject">不应用</button></div><small>也可以直接继续讨论，上一份未确认总结会自动作废。</small></div>
        <p class="red-window-notice" data-window-role="notice" role="status"></p>
        <div class="red-composer"><textarea rows="2" maxlength="4000" aria-label="导演讨论输入" placeholder="说说你想要的方向…\nEnter 发送，Shift+Enter 换行"></textarea><button type="button" data-window="send" aria-label="发送导演讨论">发送</button><button type="button" data-window="stop" hidden>停止</button></div>
        <footer class="red-chat-footer"><button type="button" data-window="clear">清空讨论记录</button><small>仅当前聊天 · 确认后只影响一次事件</small></footer>
      </div><div class="red-events-view" data-page="events" hidden>
        <div class="red-page-heading"><span class="red-eyebrow">故事的下一幕</span><h2>随机事件</h2><p>一点意外，让故事自然往前走。</p></div>
        <label class="red-event-toggle"><input type="checkbox" data-window-role="enable-events">开启本聊天的随机事件</label>
        <aside class="red-major-status" data-major-card hidden><small>重大事件</small><strong data-major-role="title"></strong><span data-major-role="turns"></span><button type="button" data-window="end-major">结束重大事件</button></aside>
        <div class="red-event-stats"><div><small>可用事件</small><strong data-window-role="event-count"></strong></div><div><small data-window-role="event-trigger-label">触发概率</small><strong data-window-role="event-probability"></strong></div></div>
        <div class="red-event-actions"><button type="button" class="red-dice-button" data-window="roll" aria-label="投掷十面骰，启用一个事件">${D10}<span data-window-role="dice-label">投掷并启用事件</span></button><div class="red-event-pool-actions"><button type="button" data-window="prepare-pool">准备 / 更新事件池</button><button type="button" data-window="reroll" title="废弃待用事件，从剩余候选中重新随机抽取">重新投掷</button></div></div>
        <button type="button" class="red-pool-link" data-view="pool">完整事件池 →</button>
        <article class="red-event-card"><div class="red-event-card-label"><span aria-hidden="true">☾</span><span data-window-role="event-label"></span></div><h3 data-window-role="event-title"></h3><p data-window-role="event-hint"></p><details data-window-role="event-reveal" hidden><summary>查看事件内容（可能剧透）</summary><p data-window-role="event-content"></p></details></article>
        <p class="red-event-notice" data-window-role="event-notice" role="status"></p><small class="red-event-footnote">点击骰子自动开启当前聊天并抽取一个事件；继续主聊天时生效，不会自动发送消息。</small>
        <div class="red-event-recent"><small>最近触发</small><span data-window-role="event-recent"></span></div><button type="button" class="red-text-button" data-view="settings">调整概率、上下文与预设 →</button>
      </div><div class="red-pool-view" data-page="pool" hidden><div class="red-page-heading"><span class="red-eyebrow">当前聊天 · 可能剧透</span><h2>完整事件池</h2><p data-window-role="pool-count"></p></div><div class="red-window-actions"><button type="button" data-window="regenerate-pool">重新生成</button></div><p class="red-help">重新生成会废弃普通候选池并重新生成，已抽取事件保留。</p><p class="red-event-notice" data-window-role="pool-notice" role="status"></p><div data-window-role="pool-list"></div><button type="button" data-view="events">返回随机事件</button></div><div class="red-settings-view" data-page="settings" hidden><div class="red-page-heading"><span class="red-eyebrow">让初月更懂你的故事</span><h2>导演设置</h2></div><p class="red-settings-intro">配置副 AI、预设与随机事件。API 连接和预设库可共用，当前聊天的选择独立保存。</p></div><div class="red-diagnostics-view" data-page="logs" hidden></div>`;
    const diceDock = doc.createElement('div'); diceDock.id = 'red_director_dice_dock';
    diceDock.innerHTML = `<aside class="red-major-status" data-major-card hidden aria-label="当前重大事件"><small>重大事件</small><strong data-major-role="title"></strong><span data-major-role="turns" aria-live="polite"></span><button type="button" data-major-action="end">结束重大事件</button></aside><button type="button" class="red-floating-die" aria-label="投掷十面骰，启用一个事件">${D10}</button><span class="red-dice-feedback" role="status" aria-live="polite"></span>`;
    const eventWindow = doc.createElement('section'); eventWindow.id = 'red_director_event_window'; eventWindow.hidden = true;
    eventWindow.setAttribute('role', 'dialog'); eventWindow.setAttribute('aria-label', '本轮随机事件');
    eventWindow.innerHTML = `<header class="red-mini-head"><span>☾ <span data-mini="label">本轮随机事件</span></span><button type="button" data-mini-action="close" aria-label="关闭事件小窗">×</button></header><div class="red-mini-body"><h3 data-mini="title"></h3><p data-mini="hint"></p><details data-mini="reveal" hidden><summary>查看事件内容（可能剧透）</summary><p data-mini="content"></p></details><p data-mini="notice" role="status" aria-live="polite"></p><div class="red-mini-failure-actions" data-mini="failure-actions" hidden><button type="button" data-mini-action="retry">重试生成</button><button type="button" data-mini-action="logs">查看日志</button></div></div><footer><button type="button" data-mini-action="pool">完整事件池</button><button type="button" data-mini-action="director">打开导演系统</button></footer>`;
    doc.body.append(window, diceDock, eventWindow);
    const floatingDie = diceDock.querySelector('.red-floating-die'), diceFeedback = diceDock.querySelector('.red-dice-feedback');
    const entry = doc.createElement('div'); entry.id = 'red_director_entry'; entry.className = 'inline-drawer red-extension-entry';
    entry.innerHTML = `<div class="inline-drawer-toggle inline-drawer-header"><b>导演系统-初月 <small>V${CURRENT_VERSION}</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display: none;"><p>和初月讨论剧情，或设置随机事件。</p><div class="red-entry-actions"><button class="menu_button menu_button_icon" type="button" data-launch="chat">打开导演系统</button><button class="menu_button menu_button_icon" type="button" data-launch="events">随机事件</button><button class="menu_button menu_button_icon" type="button" data-launch="settings">导演设置</button><button class="menu_button menu_button_icon" type="button" data-launch="logs">诊断日志</button></div></div>`;
    settingsHost.append(entry); window.querySelector('[data-page="settings"]').append(settings); settings.open = true;
    const get = name => window.querySelector(`[data-window-role="${name}"]`);
    const personaSettings = doc.createElement('div'); personaSettings.className = 'red-persona-settings';
    personaSettings.innerHTML = '<label>新聊天默认人设<select data-window-role="default-persona" aria-label="新聊天默认人设"></select></label><p>只影响小窗聊天口吻。当前聊天在剧情讨论页右上角选择；修改默认值只用于尚未设置人设的新聊天。</p>';
    window.querySelector('[data-page="settings"]').insertBefore(personaSettings, settings);
    const updateUI = mountUpdateUI(window, entry, context, doc);
    for (const select of [get('persona'), get('default-persona')]) for (const persona of PERSONAS) {
        const option = doc.createElement('option'); option.value = persona.id; option.textContent = persona.name; select.append(option);
    }
    const button = name => window.querySelector(`[data-window="${name}"]`);
    const input = window.querySelector('textarea[aria-label="导演讨论输入"]');
    const diagnosticsUI = mountDiagnosticsUI(window.querySelector('[data-page="logs"]'), director.diagnostics, doc);
    let page = 'chat', owner = null, notice = '', eventNotice = '', pendingId = null, transcriptKey = '', poolKey = '', lastFocus = null;
    let disposed = false, eventTask = null, diceAnimating = false, diceTimer = null, animationUntil = 0, shownFailureId = null;
    const mini = name => eventWindow.querySelector(`[data-mini="${name}"]`);
    function reflow() { for (const widget of [window, diceDock, eventWindow]) placeWidget(widget); }
    function setSize(size, persist = false) {
        if (!WINDOW_SIZES.has(size)) return;
        window.dataset.size = size; window.classList.remove('red-maximized');
        for (const property of ['width', 'height', 'left', 'top', 'right', 'bottom']) window.style.removeProperty(property);
        for (const item of window.querySelectorAll('[data-size]')) item.setAttribute('aria-pressed', String(item.dataset.size === size));
        button('maximize').setAttribute('aria-label', '放大窗口');
        if (!window.hidden) placeWidget(window);
        if (persist) {
            const ctx = context();
            if (ctx.extensionSettings) { ctx.extensionSettings[WORKSPACE_KEY] = { size }; ctx.saveSettingsDebounced?.(); }
        }
    }
    setSize(context().extensionSettings?.[WORKSPACE_KEY]?.size || 'medium');
    function view(name) {
        page = name;
        for (const panel of window.querySelectorAll('[data-page]')) panel.hidden = panel.dataset.page !== page;
        for (const tab of window.querySelectorAll('.red-tabs [data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === page));
        if (page === 'logs') diagnosticsUI.refresh();
    }
    function open(name = 'chat') {
        if (name === 'chat' && !director.state()) name = 'settings';
        lastFocus = doc.activeElement; window.hidden = false; view(name); refresh(); placeWidget(window);
        updateUI.opened();
        if (name === 'chat' && !doc.defaultView.matchMedia('(pointer: coarse)').matches) input.focus();
    }
    function showEvent() {
        const wasHidden = eventWindow.hidden; eventWindow.hidden = false; refresh();
        positionEvent(wasHidden);
    }
    function positionEvent(wasHidden) {
        const rect = diceDock.getBoundingClientRect(), width = eventWindow.getBoundingClientRect().width, viewport = visibleViewport(doc.defaultView);
        const beside = rect.left - width - 8 >= viewport.left + 8;
        placeWidget(eventWindow, wasHidden ? { left: beside ? rect.left - width - 8 : viewport.left + 8,
            top: beside ? rect.top : viewport.top + 8 } : undefined);
    }
    function renderPool(state) {
        const pending = state?.pendingEvent?.event;
        const candidates = state?.eventPool || [], guided = (state?.discussion?.guide?.pool || []).filter(item => item.id !== pending?.id);
        get('pool-count').textContent = `已抽取 ${pending ? 1 : 0} · ${state?.majorEvent ? '重大事件相关候选' : '普通候选'} ${candidates.length} · 本次方向候选 ${guided.length}`;
        const key = JSON.stringify([state?.owner, pending, candidates, guided, state?.majorEvent?.id]);
        if (key === poolKey) return;
        poolKey = key; const list = get('pool-list'); list.replaceChildren();
        for (const [label, events] of [['已抽取 · 等待本轮生效', pending ? [pending] : []], [state?.majorEvent ? '重大事件相关事件池' : '普通事件池', candidates], ['本次讨论方向 · 仅生效一次', guided]]) {
            if (!events.length) continue;
            const heading = doc.createElement('h3'); heading.textContent = label; list.append(heading);
            for (const event of events) {
                const detail = doc.createElement('details'), title = doc.createElement('summary'), content = doc.createElement('p');
                title.textContent = `${event.severity === 'major' ? '重大 · ' : ''}${event.title}`; content.textContent = event.content; detail.append(title, content); list.append(detail);
            }
        }
        if (!list.childNodes.length) { const empty = doc.createElement('p'); empty.textContent = state ? '事件池还没有内容。到随机事件页准备事件，或直接点击骰子。' : '请先打开一个聊天。'; list.append(empty); }
    }
    function refresh() {
        const state = director.state(), disc = state?.discussion, currentOwner = state?.owner || null;
        if (owner !== currentOwner) { owner = currentOwner; shownFailureId = null; input.value = ''; notice = ''; eventNotice = ''; transcriptKey = ''; pendingId = null; get('event-reveal').open = false; eventWindow.hidden = true; mini('reveal').open = false; }
        const ctx = context(); get('owner').textContent = state ? `${ctx.name2 || '当前角色'} · 当前聊天` : '未打开聊天 · 正在配置新聊天默认值';
        const persona = discussionPersona(disc?.persona);
        get('persona').value = persona.id; get('persona').disabled = !state || Boolean(director.discussion?.chatTask);
        get('persona-hint').textContent = persona.description;
        get('default-persona').value = normalizePersona(ctx.extensionSettings?.[PERSONA_PREFERENCES_KEY]?.defaultPersona);
        get('default-persona').disabled = !ctx.extensionSettings;
        input.placeholder = `说说你想要的方向，也可以让${persona.name}提建议…\nEnter 发送，Shift+Enter 换行`;
        const key = JSON.stringify([disc?.messages, disc?.persona, Boolean(director.discussion?.chatTask)]);
        if (key !== transcriptKey) {
            transcriptKey = key; const log = get('messages'); log.replaceChildren();
            if (!disc?.messages.length) {
                const intro = doc.createElement('div'); intro.className = 'red-chat-intro';
                intro.innerHTML = `<span class="red-intro-moon" aria-hidden="true">${persona.mark}</span><strong>和${persona.name}一起想想故事的下一步</strong><p>描述你想要的氛围、变化或禁忌。没有想法时，${persona.name}也可以提出建议。</p><button type="button" data-starter="接下来可以发生什么？给我几个自然的方向。">接下来可以发生什么？</button><button type="button" data-starter="帮我梳理当前剧情，再建议一个适合的小变化。">帮我理一理当前剧情</button>`; log.append(intro);
            }
            for (const message of disc?.messages || []) {
                const bubble = doc.createElement('article'); bubble.className = `red-bubble red-${message.role}`;
                const author = doc.createElement('small'), text = doc.createElement('p'), avatar = doc.createElement('span'), body = doc.createElement('div');
                const speaker = message.persona ? discussionPersona(message.persona) : null;
                avatar.className = 'red-chat-avatar'; avatar.setAttribute('aria-hidden', 'true'); avatar.textContent = message.role === 'user' ? '你' : speaker?.mark || '☾'; body.className = 'red-bubble-body';
                author.textContent = message.role === 'user' ? '你' : speaker?.name || '初月'; text.textContent = message.content;
                body.append(author, text); bubble.append(avatar, body); log.append(bubble);
            }
            if (director.discussion?.chatTask) { const thinking = doc.createElement('p'); thinking.className = 'red-thinking'; thinking.textContent = `${persona.name}正在思考…`; log.append(thinking); }
            log.scrollTop = log.scrollHeight;
        }
        const guideStatus = get('guide-status'); guideStatus.replaceChildren();
        if (disc?.guide) {
            const text = doc.createElement('span');
            text.textContent = director.discussion?.guideTask ? '正在准备本次方向…' : (disc.guide.pool.length ? '等待下一次事件 · 仅生效一次' : '本次方向尚未准备好');
            const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.dataset.window = 'cancel-guide'; cancel.textContent = '取消方向'; cancel.disabled = director.busy;
            guideStatus.append(text, cancel);
            const summary = doc.createElement('p'); summary.textContent = disc.guide.summary; guideStatus.append(summary);
            if (!disc.guide.pool.length && !director.discussion?.guideTask) { const retry = doc.createElement('button'); retry.type = 'button'; retry.dataset.window = 'retry-guide'; retry.textContent = '重新准备'; guideStatus.append(retry); }
            if (state.pendingEvent?.cycleKey && state.pendingEvent.guideId !== disc.guide.id) { const hint = doc.createElement('small'); hint.textContent = '当前已准备的回合保留原安排；本方向用于下一次新事件。'; guideStatus.append(hint); }
            if (!state.enabled) { const hint = doc.createElement('small'); hint.textContent = '请在设置中开启本聊天的随机事件导演。'; guideStatus.append(hint); }
        } else guideStatus.textContent = disc?.lastUsed ? '上次方向已使用并清空 · 新事件按普通设置生成' : (disc?.proposal ? '总结尚未应用' : '自由讨论 · 当前没有待用方向');
        get('proposal').hidden = !disc?.proposal; get('summary').textContent = disc?.proposal?.summary || '';
        button('accept').disabled = director.busy;
        const running = Boolean(director.discussion?.chatTask);
        button('send').disabled = !state || running; button('send').hidden = running; button('stop').hidden = !running;
        button('clear').disabled = !state || running; input.disabled = !state;
        get('notice').textContent = notice || disc?.error || '';
        const pending = state?.pendingEvent?.event;
        if (pendingId !== (pending?.id || null)) { pendingId = pending?.id || null; get('event-reveal').open = false; mini('reveal').open = false; eventNotice = ''; }
        get('enable-events').checked = Boolean(state?.enabled); get('enable-events').disabled = !state;
        get('event-count').textContent = state ? `${state.eventPool.length} / ${state.targetCount}` : '—';
        get('event-trigger-label').textContent = state?.fixedRoundEnabled ? '固定回合触发' : '触发概率';
        get('event-probability').textContent = state ? (state.fixedRoundEnabled ? `每 ${state.fixedRoundInterval} 回合` : `${state.triggerProbability}%`) : '—';
        const actionRunning = Boolean(eventTask), rolling = diceAnimating || (eventTask?.owner === currentOwner && eventTask?.action === 'roll');
        const preparing = Boolean(director.fill || director.discussion?.guideTask);
        const failure = state?.refillStopped ? state.generationFailure : null;
        const failed = Boolean(failure && !preparing && !actionRunning);
        get('event-label').textContent = pending ? '已抽取 · 等待本轮生成' : (preparing || actionRunning ? '初月正在准备事件' : '下一次意外，尚未揭晓');
        get('event-title').textContent = pending?.title || (state ? '让故事多一点可能' : '请先打开一个聊天');
        get('event-hint').textContent = pending ? (state.majorEvent && pending.id === state.majorEvent.id
            ? `重大事件已准备，首次成功回复后开始计时，持续 ${state.majorEvent.duration} 回合。`
            : '事件已准备，将在对应的正常生成中生效；成功回复后结束本次注入。') : '保持自然的随机触发，或亲手掷骰，迎接一个小变化。';
        get('event-reveal').hidden = !pending; get('event-content').textContent = pending?.content || '';
        get('event-recent').textContent = state?.recentEvent?.title || '暂无';
        const stoppedNotice = state?.refillStopped && !preparing && !actionRunning ? '事件生成已暂停；请使用准备按钮或骰子小窗中的“重试生成”。' : '';
        get('event-notice').textContent = state?.error || eventNotice || stoppedNotice || (!state?.enabled && state ? '点击骰子即可开启本聊天并准备一个事件。' : '');
        get('pool-notice').textContent = state?.error || eventNotice || stoppedNotice || '';
        // The die always remains draggable and can reopen the current event, even while a request is busy.
        button('roll').disabled = false; floatingDie.disabled = false;
        button('prepare-pool').disabled = !state?.enabled || director.busy || preparing || actionRunning;
        button('reroll').disabled = !state || director.busy || (preparing && !(state.majorEvent && !state.majorEvent.started && !director.discussion?.guideTask)) || actionRunning;
        button('regenerate-pool').disabled = !state?.enabled || director.busy || preparing || actionRunning;
        get('dice-label').textContent = pending ? '本轮事件已启用' : (actionRunning || preparing ? '正在准备…' : '投掷并启用事件');
        button('roll').classList.toggle('red-is-rolling', rolling); floatingDie.classList.toggle('red-is-rolling', rolling);
        floatingDie.classList.toggle('red-die-ready', Boolean(pending));
        const diceTitle = !state ? '请先打开一个聊天' : (pending ? '本轮事件已启用，继续主聊天即可' : (director.busy ? '主 AI 正在生成，请稍候' : (preparing || actionRunning ? '正在准备事件，请稍候' : '投掷十面骰，开启当前聊天并抽取一个事件')));
        floatingDie.title = diceTitle; button('roll').title = diceTitle;
        floatingDie.setAttribute('aria-busy', String(actionRunning || preparing)); button('roll').setAttribute('aria-busy', String(actionRunning || preparing));
        diceDock.hidden = Boolean(director.settingsState()?.hideDice);
        const major = state?.majorEvent;
        diceDock.classList.toggle('red-major-active', Boolean(major));
        for (const card of [window.querySelector('[data-major-card]'), diceDock.querySelector('[data-major-card]')]) {
            card.hidden = !major;
            card.querySelector('[data-major-role="title"]').textContent = major?.event.title || '';
            card.querySelector('[data-major-role="turns"]').textContent = major
                ? `${state.enabled ? '' : '已暂停 · '}剩余 ${major.remaining} / ${major.duration} 回合${major.started ? (major.remaining === 1 ? ' · 本轮收尾' : '') : ' · 等待首次生效'}` : '';
            card.querySelector('button').disabled = !major || director.busy || actionRunning;
        }
        diceFeedback.textContent = failed ? '生成失败' : (preparing || actionRunning ? '准备中…' : (pending ? '本轮已启用' : eventNotice));
        mini('label').textContent = failed ? '生成失败 · 已暂停' : get('event-label').textContent;
        mini('title').textContent = failed ? '事件未生成成功' : (preparing || actionRunning ? '正在准备事件…' : (pending?.title || (state ? '本轮暂无事件' : '请先打开一个聊天')));
        mini('hint').textContent = failed ? `原因：${failure.message}` : (preparing || actionRunning ? '准备完成后会在这里显示抽取结果。' : (pending ? get('event-hint').textContent : (director.busy ? '主 AI 正在生成，请稍后再投掷。' : '点击骰子抽取事件，继续主聊天时生效。')));
        mini('reveal').hidden = !pending || failed || preparing || actionRunning; mini('content').textContent = pending?.content || '';
        mini('notice').textContent = failed ? `已停止自动重试。${pending ? '原先已抽取的事件保留。' : ''}正常聊天可继续；要重新生成，请点击下方按钮。` : (preparing || actionRunning ? '' : (state?.error || eventNotice || stoppedNotice));
        mini('failure-actions').hidden = !failure;
        const retry = eventWindow.querySelector('[data-mini-action="retry"]');
        retry.disabled = !state || director.busy || preparing || actionRunning;
        retry.textContent = preparing || actionRunning ? '正在重试…' : '重试生成';
        if (!failure) shownFailureId = null;
        const showFailure = failed && shownFailureId !== failure.id;
        if (showFailure) { shownFailureId = failure.id; eventWindow.hidden = false; }
        renderPool(state); reflow();
        if (showFailure) positionEvent(true);
        if (page === 'logs') diagnosticsUI.refresh();
    }
    async function eventAction(action) {
        if (action === 'roll' || action === 'retry') showEvent();
        const state = director.state(), currentOwner = state?.owner;
        const cancellingMajor = action === 'end-major' || (action === 'reroll' && state?.majorEvent && !state.majorEvent.started);
        if (!state || eventTask || director.busy || (!cancellingMajor && (director.fill || director.discussion?.guideTask)) || (action === 'roll' && (state.pendingEvent || (state.refillStopped && state.generationFailure)))) return;
        const token = { action, owner: currentOwner }; eventTask = token;
        if (action === 'roll' || action === 'reroll') {
            diceAnimating = true; animationUntil = Date.now() + 650;
            if (diceTimer) doc.defaultView.clearTimeout(diceTimer);
            diceTimer = doc.defaultView.setTimeout(() => { diceTimer = null; diceAnimating = false; if (!disposed) refresh(); }, 650);
        }
        try {
            eventNotice = action === 'roll' ? '正在投掷并准备事件…' : '正在更新事件池…';
            const task = action === 'end-major' ? director.endMajor() : action === 'retry' ? director.retryGeneration({ enable: true })
                : action === 'reroll' ? director.reroll({ enable: true })
                    : action === 'regenerate-pool' ? director.regeneratePool()
                        : action === 'roll' ? director.rollNow({ enable: true }) : director.refill(true); refresh();
            const done = await task;
            if (disposed || director.state()?.owner !== currentOwner) return;
            refresh();
                const current = director.state();
                eventNotice = action === 'end-major' && done ? '重大事件已结束，恢复普通随机事件。' : done ? (!['prepare-pool', 'regenerate-pool'].includes(action) ? '本轮事件已启用，继续主聊天即可。' : '事件池已更新，等待故事的下一幕。')
                    : current?.poolGenerated && !current.eventPool.length && !current.discussion.guide && !current.refillStopped
                        ? '事件池已用完，请等待更新回合，或手动更新事件池。' : '本次未启用新事件，请检查连接或稍后重试。';
        } catch (e) { if (!disposed && director.state()?.owner === currentOwner) eventNotice = e.message; }
        finally { if (eventTask === token) eventTask = null; if (Date.now() >= animationUntil) diceAnimating = false; if (!disposed) refresh(); }
    }
    async function send(text = input.value) {
        if (!String(text).trim() || director.discussion?.chatTask) return;
        const previous = input.value; notice = ''; input.value = '';
        try { await director.discussion.send(text); } catch (e) { input.value = previous; notice = e.message; }
        refresh();
    }
    function click(event) {
        const target = event.target.closest('button'); if (!target) return;
        if (target.dataset.size) { try { setSize(target.dataset.size, true); } catch (e) { notice = e.message; refresh(); } return; }
        if (target.dataset.view) { view(target.dataset.view); return; }
        if (target.dataset.starter) { void send(target.dataset.starter); return; }
        const action = target.dataset.window; if (!action) return;
        notice = '';
        try {
            const proposal = director.state()?.discussion.proposal;
            if (action === 'close') { window.hidden = true; lastFocus?.focus?.(); }
            else if (action === 'maximize') {
                window.classList.toggle('red-maximized'); const maximized = window.classList.contains('red-maximized');
                for (const property of ['width', 'height']) window.style.removeProperty(property);
                target.setAttribute('aria-label', maximized ? '还原窗口' : '放大窗口');
                for (const item of window.querySelectorAll('[data-size]')) item.setAttribute('aria-pressed', String(!maximized && item.dataset.size === window.dataset.size));
            }
            else if (action === 'send') { void send(); return; }
            else if (action === 'stop') director.discussion.stop();
            else if (action === 'accept') director.discussion.accept(proposal?.id);
            else if (action === 'reject') director.discussion.reject(proposal?.id);
            else if (action === 'cancel-guide') director.discussion.cancelGuide();
            else if (action === 'retry-guide') void director.discussion.prepareGuide();
            else if (action === 'clear') director.discussion.clearHistory();
            else if (['roll', 'reroll', 'prepare-pool', 'regenerate-pool', 'end-major'].includes(action)) { void eventAction(action); return; }
        } catch (e) { notice = e.message; }
        refresh();
    }
    const keydown = event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
    };
    const launch = event => { const target = event.target.closest('[data-launch]'); if (target) open(target.dataset.launch); };
    const throwDice = () => { void eventAction('roll'); };
    const change = event => {
        try {
            if (event.target === get('enable-events')) director.update({ enabled: event.target.checked });
            else if (event.target === get('persona')) { director.discussion.setPersona(event.target.value); notice = ''; }
            else if (event.target === get('default-persona')) {
                const ctx = context();
                if (ctx.extensionSettings) {
                    ctx.extensionSettings[PERSONA_PREFERENCES_KEY] = { defaultPersona: normalizePersona(event.target.value) };
                    ctx.saveSettingsDebounced?.();
                }
            } else return;
        } catch (e) { notice = e.message; }
        refresh();
    };
    const head = window.querySelector('header');
    const stopMainDrag = makeDraggable(window, head, { canDrag: () => !window.classList.contains('red-maximized') });
    const stopDiceDrag = makeDraggable(diceDock, floatingDie, { ignoreButtons: false });
    const stopEventDrag = makeDraggable(eventWindow, eventWindow.querySelector('header'));
    const miniClick = event => {
        const action = event.target.closest('[data-mini-action]')?.dataset.miniAction;
        if (action === 'close') eventWindow.hidden = true;
        else if (action === 'retry') void eventAction('retry');
        else if (action === 'logs') { eventWindow.hidden = true; open('logs'); }
        else if (action === 'pool' || action === 'director') { eventWindow.hidden = true; open(action === 'pool' ? 'pool' : 'events'); }
    };
    window.addEventListener('click', click); window.addEventListener('change', change); input.addEventListener('keydown', keydown); entry.addEventListener('click', launch);
    floatingDie.addEventListener('click', throwDice);
    const majorEnd = () => { void eventAction('end-major'); };
    diceDock.querySelector('[data-major-action="end"]').addEventListener('click', majorEnd);
    eventWindow.addEventListener('click', miniClick);
    doc.defaultView.addEventListener('resize', reflow);
    doc.defaultView.visualViewport?.addEventListener('resize', reflow);
    doc.defaultView.visualViewport?.addEventListener('scroll', reflow);
    const menuButton = doc.createElement('button'); menuButton.id = 'red_director_menu'; menuButton.type = 'button'; menuButton.className = 'list-group-item flex-container flexGap5';
    menuButton.innerHTML = '<i class="fa-solid fa-moon extensionsMenuExtensionButton" aria-hidden="true"></i><span>导演系统-初月</span>';
    const fromMenu = () => open('chat'); menuButton.addEventListener('click', fromMenu);
    function mountMenu() { const menu = doc.querySelector('#extensionsMenu'); if (menu && !menuButton.isConnected) menu.append(menuButton); }
    mountMenu();
    const Observer = doc.defaultView?.MutationObserver; const observer = Observer ? new Observer(mountMenu) : null;
    observer?.observe(doc.body, { childList: true, subtree: true });
    refresh();
    return { refresh, open, dispose() {
        disposed = true; if (diceTimer) doc.defaultView.clearTimeout(diceTimer);
        stopMainDrag(); stopDiceDrag(); stopEventDrag();
        doc.defaultView.removeEventListener('resize', reflow);
        doc.defaultView.visualViewport?.removeEventListener('resize', reflow);
        doc.defaultView.visualViewport?.removeEventListener('scroll', reflow);
        diceDock.querySelector('[data-major-action="end"]').removeEventListener('click', majorEnd);
        eventWindow.removeEventListener('click', miniClick); eventWindow.remove();
        floatingDie.removeEventListener('click', throwDice); diceDock.remove();
        diagnosticsUI.dispose();
        updateUI.dispose();
        observer?.disconnect(); menuButton.removeEventListener('click', fromMenu); menuButton.remove(); entry.removeEventListener('click', launch); entry.remove();
        window.removeEventListener('click', click); window.removeEventListener('change', change); input.removeEventListener('keydown', keydown);
        window.remove();
    } };
}
