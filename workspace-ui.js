export function mountWorkspace(director, context, settings, settingsHost, doc = document) {
    doc.querySelector('#red_director_window')?.remove(); doc.querySelector('#red_director_entry')?.remove();
    const window = doc.createElement('section');
    window.id = 'red_director_window'; window.className = 'red-window'; window.hidden = true;
    window.setAttribute('role', 'dialog'); window.setAttribute('aria-label', '导演系统-初月');
    window.innerHTML = `<header class="red-window-head"><div class="red-window-title"><span class="red-moon" aria-hidden="true">☾</span><strong>导演系统-初月</strong></div>
      <div class="red-window-tools"><button type="button" data-window="maximize" aria-label="放大窗口" title="放大 / 还原">⛶</button><button type="button" data-window="close" aria-label="关闭导演窗口" title="关闭">×</button></div></header>
      <nav class="red-tabs" aria-label="导演系统页面"><button type="button" data-view="chat" aria-pressed="true">剧情讨论</button><button type="button" data-view="settings" aria-pressed="false">设置</button><span data-window-role="owner"></span></nav>
      <div class="red-chat-view" data-page="chat"><div class="red-guide-status" data-window-role="guide-status"></div>
        <div class="red-transcript" data-window-role="messages" role="log" aria-label="导演讨论记录" aria-live="polite"></div>
        <div class="red-proposal" data-window-role="proposal" hidden><strong>本次方向总结</strong><p data-window-role="summary"></p><div class="red-window-actions"><button type="button" data-window="accept">应用到下一次事件</button><button type="button" data-window="reject">不应用</button></div><small>也可以直接继续讨论，上一份未确认总结会自动作废。</small></div>
        <p class="red-window-notice" data-window-role="notice" role="status"></p>
        <div class="red-composer"><textarea rows="3" maxlength="4000" aria-label="导演讨论输入" placeholder="说说你想要的方向，也可以让初月提建议…\nEnter 发送，Shift+Enter 换行"></textarea><button type="button" data-window="send" aria-label="发送导演讨论">发送</button><button type="button" data-window="stop" hidden>停止</button></div>
        <footer class="red-chat-footer"><button type="button" data-window="clear">清空讨论记录</button><small>仅当前聊天 · 确认后只影响一次事件</small></footer>
      </div><div class="red-settings-view" data-page="settings" hidden><p class="red-settings-intro">配置初月使用的副 AI、预设与随机事件。API 连接和预设库可共用，当前聊天的选择独立保存。</p></div>`;
    doc.body.append(window);
    const entry = doc.createElement('div'); entry.id = 'red_director_entry'; entry.className = 'inline-drawer red-extension-entry';
    entry.innerHTML = `<div class="inline-drawer-toggle inline-drawer-header"><b>导演系统-初月 <small>V0.1.5</small></b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content" style="display: none;"><p>和初月讨论剧情，或设置随机事件。</p><div class="red-entry-actions"><button class="menu_button menu_button_icon" type="button" data-launch="chat">打开导演系统</button><button class="menu_button menu_button_icon" type="button" data-launch="settings">导演设置</button></div></div>`;
    settingsHost.append(entry); window.querySelector('[data-page="settings"]').append(settings); settings.open = true;
    const get = name => window.querySelector(`[data-window-role="${name}"]`);
    const button = name => window.querySelector(`[data-window="${name}"]`);
    const input = window.querySelector('textarea[aria-label="导演讨论输入"]');
    let page = 'chat', owner = null, notice = '', transcriptKey = '', lastFocus = null, drag = null;
    function view(name) {
        page = name;
        for (const panel of window.querySelectorAll('[data-page]')) panel.hidden = panel.dataset.page !== page;
        for (const tab of window.querySelectorAll('[data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === page));
    }
    function open(name = 'chat') { lastFocus = doc.activeElement; window.hidden = false; view(name); refresh(); if (name === 'chat') input.focus(); }
    function refresh() {
        const state = director.state(), disc = state?.discussion, currentOwner = state?.owner || null;
        if (owner !== currentOwner) { owner = currentOwner; input.value = ''; notice = ''; transcriptKey = ''; }
        const ctx = context(); get('owner').textContent = state ? `${ctx.name2 || '当前角色'} · 当前聊天` : '未打开聊天';
        const key = JSON.stringify([disc?.messages, Boolean(director.discussion?.chatTask)]);
        if (key !== transcriptKey) {
            transcriptKey = key; const log = get('messages'); log.replaceChildren();
            if (!disc?.messages.length) {
                const intro = doc.createElement('div'); intro.className = 'red-chat-intro';
                intro.innerHTML = `<span class="red-intro-moon" aria-hidden="true">☾</span><strong>一起想想故事的下一步</strong><p>描述你想要的氛围、变化或禁忌。没有想法时，初月也可以提出建议。</p><button type="button" data-starter="接下来可以发生什么？给我几个自然的方向。">接下来可以发生什么？</button><button type="button" data-starter="帮我梳理当前剧情，再建议一个适合的小变化。">帮我理一理当前剧情</button>`; log.append(intro);
            }
            for (const message of disc?.messages || []) {
                const bubble = doc.createElement('article'); bubble.className = `red-bubble red-${message.role}`;
                const author = doc.createElement('small'), text = doc.createElement('p');
                author.textContent = message.role === 'user' ? '你' : '初月'; text.textContent = message.content;
                bubble.append(author, text); log.append(bubble);
            }
            if (director.discussion?.chatTask) { const thinking = doc.createElement('p'); thinking.className = 'red-thinking'; thinking.textContent = '初月正在思考…'; log.append(thinking); }
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
    }
    async function send(text = input.value) {
        if (!String(text).trim() || director.discussion?.chatTask) return;
        const previous = input.value; notice = ''; input.value = '';
        try { await director.discussion.send(text); } catch (e) { input.value = previous; notice = e.message; }
        refresh();
    }
    function click(event) {
        const target = event.target.closest('button'); if (!target) return;
        if (target.dataset.view) { view(target.dataset.view); return; }
        if (target.dataset.starter) { void send(target.dataset.starter); return; }
        const action = target.dataset.window; if (!action) return;
        notice = '';
        try {
            const proposal = director.state()?.discussion.proposal;
            if (action === 'close') { window.hidden = true; lastFocus?.focus?.(); }
            else if (action === 'maximize') { window.classList.toggle('red-maximized'); target.setAttribute('aria-label', window.classList.contains('red-maximized') ? '还原窗口' : '放大窗口'); }
            else if (action === 'send') { void send(); return; }
            else if (action === 'stop') director.discussion.stop();
            else if (action === 'accept') director.discussion.accept(proposal?.id);
            else if (action === 'reject') director.discussion.reject(proposal?.id);
            else if (action === 'cancel-guide') director.discussion.cancelGuide();
            else if (action === 'retry-guide') void director.discussion.prepareGuide();
            else if (action === 'clear') director.discussion.clearHistory();
        } catch (e) { notice = e.message; }
        refresh();
    }
    const keydown = event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
    };
    const launch = event => { const target = event.target.closest('[data-launch]'); if (target) open(target.dataset.launch); };
    const head = window.querySelector('header');
    const dragStart = event => {
        if (event.target.closest('button') || event.button !== 0 || window.classList.contains('red-maximized')) return;
        const rect = window.getBoundingClientRect(); drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        head.setPointerCapture(event.pointerId);
    };
    const dragMove = event => {
        if (!drag) return;
        const width = window.getBoundingClientRect().width, height = window.getBoundingClientRect().height;
        window.style.left = `${Math.max(0, Math.min(doc.documentElement.clientWidth - width, event.clientX - drag.x))}px`;
        window.style.top = `${Math.max(0, Math.min(doc.documentElement.clientHeight - height, event.clientY - drag.y))}px`;
        window.style.right = 'auto'; window.style.bottom = 'auto';
    };
    const dragEnd = () => { drag = null; };
    window.addEventListener('click', click); input.addEventListener('keydown', keydown); entry.addEventListener('click', launch);
    head.addEventListener('pointerdown', dragStart); head.addEventListener('pointermove', dragMove); head.addEventListener('pointerup', dragEnd); head.addEventListener('pointercancel', dragEnd);
    const menuButton = doc.createElement('button'); menuButton.id = 'red_director_menu'; menuButton.type = 'button'; menuButton.className = 'list-group-item flex-container flexGap5';
    menuButton.innerHTML = '<i class="fa-solid fa-moon extensionsMenuExtensionButton" aria-hidden="true"></i><span>导演系统-初月</span>';
    const fromMenu = () => open('chat'); menuButton.addEventListener('click', fromMenu);
    function mountMenu() { const menu = doc.querySelector('#extensionsMenu'); if (menu && !menuButton.isConnected) menu.append(menuButton); }
    mountMenu();
    const Observer = doc.defaultView?.MutationObserver; const observer = Observer ? new Observer(mountMenu) : null;
    observer?.observe(doc.body, { childList: true, subtree: true });
    refresh();
    return { refresh, open, dispose() {
        observer?.disconnect(); menuButton.removeEventListener('click', fromMenu); menuButton.remove(); entry.removeEventListener('click', launch); entry.remove();
        window.removeEventListener('click', click); input.removeEventListener('keydown', keydown);
        head.removeEventListener('pointerdown', dragStart); head.removeEventListener('pointermove', dragMove); head.removeEventListener('pointerup', dragEnd); head.removeEventListener('pointercancel', dragEnd); window.remove();
    } };
}
