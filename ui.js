import { CURRENT_VERSION } from './updates.js';

export function mountUI(director, context, doc = document) {
    const host = doc.querySelector('#extensions_settings2') || doc.querySelector('#extensions_settings');
    if (!host) return null;
    doc.querySelector('#random_event_director_panel')?.remove();
    const root = doc.createElement('details');
    root.id = 'random_event_director_panel'; root.className = 'red-panel';
    root.innerHTML = `<summary>随机事件导演 <small>V${CURRENT_VERSION}</small></summary>
      <div class="red-body">
      <p class="red-help">为当前聊天加入偶发情境。先配置副 AI，再开启随机事件。</p>
      <p class="red-help" data-role="settings-scope"></p>
      <label><input type="checkbox" data-setting="enabled"> <span data-role="enabled-label">开启本聊天的随机事件导演</span></label>
      <label><input type="checkbox" data-setting="fixedRoundEnabled"> 开启固定回合随机</label>
      <div data-role="fixed-rounds" hidden><label>固定回合数<input class="text_pole" type="number" min="1" max="100" data-setting="fixedRoundInterval"></label><p class="red-help" data-role="fixed-progress"></p></div>
      <div class="red-grid">
        <label>随机事件概率（%）<input class="text_pole" type="number" min="0" max="100" data-setting="triggerProbability"></label>
        <label>近期消息数量<input class="text_pole" type="number" min="1" max="40" data-setting="contextMessages"></label>
      </div>
      <label><input type="checkbox" data-setting="includeHiddenMessages"> 读取隐藏楼层</label>
      <p class="red-help">勾选后，后续事件生成和小窗讨论也会读取隐藏楼层，仍按近期消息数量与字数上限截取。不改变主聊天的隐藏状态。</p>
      <label><input type="checkbox" data-setting="hideDice"> 隐藏悬浮骰子</label>
      <label class="red-column">事件注入方式<select class="text_pole" data-setting="injectionMode">
        <option value="user">现有方式 · 随用户消息</option>
        <option value="system">兼容方式 · 独立系统消息</option>
        <option value="force">强制注入 · 每个生成请求</option>
      </select></label>
      <p class="red-help">兼容方式使用独立系统消息。强制方式把本轮待用事件加入每个可识别的生成请求，包括后台、重试和未知类型请求；完整正文成功后结束本轮。生成过程中暂不能切换。</p>
      <details><summary>高级设置</summary><div class="red-grid">
        <label><input type="checkbox" data-setting="outgoingInjection"> 增强事件注入</label>
        <label>事件池目标数量<input class="text_pole" type="number" min="1" max="20" data-setting="targetCount"></label>
        <label>事件池更新间隔上限（回合）<input class="text_pole" type="number" min="5" max="10" data-setting="expiryTurns"></label>
        <label>重大事件持续回合<input class="text_pole" type="number" min="1" max="20" data-setting="majorEventTurns"></label>
        <label>副 AI 超时（秒）<input class="text_pole" type="number" min="5" max="180" data-setting="timeoutSeconds"></label>
      </div></details>
      <p class="red-help">每批事件池在 5 回合至设置上限之间随机选定更新回合，最多 10 回合更新一次。到期前用完不自动补充，掷骰也不会提前补池；可手动更新事件池。到期时未用完的候选也会更新，已抽取的事件保留。</p>
      <p class="red-help">重大事件默认持续 5 个成功回复回合，期间使用相关事件池，最后一回合尝试自然收尾。到期或手动结束后恢复普通池；失败和同一回合重生成不重复计数。修改持续回合只影响之后抽取的重大事件。</p>
      <p class="red-help">增强事件注入用于前两种注入方式：发送前补回缺失的本轮事件、整理重复副本，保留其他插件的内容。遇到特殊预设不兼容时可关闭。强制方式始终补写事件，不受此开关影响。</p>
      <div data-role="connection-host"></div>
      <div data-role="current-model" class="red-body"><label><input type="checkbox" data-setting="useCurrentModel"> 沿用主 API 的当前模型</label>
      <p class="red-help">已使用主 API 的连接；取消勾选仅用于在同一 API 下指定其他模型。</p>
      <label class="red-column">副 AI 模型<input class="text_pole" data-setting="model" list="red-models" placeholder="选择已有模型或填写同一 API 下的模型 ID"></label>
      <datalist id="red-models"></datalist>
      <p class="red-help">取消上方勾选可指定当前连接中的其他模型。</p></div>
      <div data-role="header-host"></div>
      <div data-role="preset-host"></div>
      <details><summary>补充世界观（可选）</summary><textarea class="text_pole" rows="4" data-setting="worldNotes" placeholder="副 AI 自动读取角色描述、人格、场景和近期对话。关键世界书设定可在此补充。"></textarea></details>
      <p data-role="count"></p><p data-role="pending"></p><p data-role="recent"></p>
      <div class="red-actions"><button class="menu_button" type="button" data-action="roll">立即掷骰</button>
      <button class="menu_button" type="button" data-action="generate">生成 / 重新生成事件池</button></div>
      <details data-role="pool"><summary>查看事件池（可能剧透）</summary><div data-role="events"></div></details>
      <p data-role="status" aria-live="polite"></p>
      </div>`;
    host.append(root);
    const connectionUI = mountConnectionUI(root.querySelector('[data-role="connection-host"]'), director, doc);
    const headerUI = mountHeaderUI(root.querySelector('[data-role="header-host"]'), director, context, doc);
    const presetUI = mountPresetUI(root.querySelector('[data-role="preset-host"]'), director, context, doc);
    let notice = '', lastOwner = null, workspace;
    const field = name => root.querySelector(`[data-role="${name}"]`);
    function refresh() {
        let s, chat;
        try { chat = director.state(); s = director.settingsState(); } catch (e) { field('status').textContent = e.message; return; }
        field('settings-scope').textContent = chat ? '正在编辑当前聊天的设置。' : '未打开聊天：可以配置 API 和预设；下方选项保存为新聊天默认值，不改变已有聊天。';
        field('enabled-label').textContent = chat ? '开启本聊天的随机事件导演' : '新聊天默认开启随机事件导演';
        if (s?.owner !== lastOwner) { notice = ''; lastOwner = s?.owner; }
        if (!s?.pendingEvent && notice === '随机事件已准备，将在下一次正常生成时生效。') notice = '';
        for (const el of root.querySelectorAll('[data-setting]')) {
            const name = el.dataset.setting;
            el.disabled = !s || (name === 'model' && s.useCurrentModel) || (name === 'triggerProbability' && s.fixedRoundEnabled)
                || (name === 'injectionMode' && director.busy);
            if (el.type === 'checkbox') el.checked = Boolean(s?.[name]);
            else if (doc.activeElement !== el) el.value = s?.[name] ?? '';
        }
        field('fixed-rounds').hidden = !s?.fixedRoundEnabled;
        field('fixed-progress').textContent = chat ? `每 ${s.fixedRoundInterval} 个新回合随机触发一次，当前已完成 ${chat.fixedRoundProgress} / ${s.fixedRoundInterval} 回合。完整回复后计数，重生成和后台请求不重复计数。`
            : '默认 5 回合，可自行设置；新聊天从第一个回合开始计数。关闭后恢复概率触发。';
        field('count').textContent = chat ? `当前可用事件池：${chat.eventPool.length} / ${chat.targetCount}${director.fill ? ' · 副 AI 生成中…' : ''}` : '打开聊天后才能生成事件。';
        field('pending').textContent = chat?.pendingEvent ? '随机事件已准备，将在对应的下一次正常生成时生效。' : '当前没有待用事件。';
        field('recent').textContent = `最近触发：${chat?.recentEvent?.title || '暂无'}`;
        field('status').textContent = chat?.error || notice || (chat?.refillStopped && !director.fill && !director.discussion?.guideTask ? '事件生成已暂停；请使用生成按钮或骰子小窗中的“重试生成”。' : '');
        for (const button of root.querySelectorAll('[data-action]')) button.disabled = !chat?.enabled || director.busy || Boolean(director.fill);
        const list = root.querySelector('#red-models'); list.replaceChildren();
        const models = new Set();
        for (const select of doc.querySelectorAll('select[id*="model"]')) for (const option of select.options) {
            if (option.value && !option.disabled) models.add(option.value);
        }
        for (const model of models) { const option = doc.createElement('option'); option.value = model; list.append(option); }
        if (field('pool').open) showEvents(chat);
        field('current-model').hidden = director.connection?.read().mode === 'independent';
        connectionUI.refresh(); headerUI.refresh();
        presetUI.refresh();
        workspace?.refresh();
    }
    function showEvents(s) {
        const list = field('events'); list.replaceChildren();
        for (const event of [...(s?.pendingEvent ? [s.pendingEvent.event] : []), ...(s?.eventPool || [])]) {
            const item = doc.createElement('article'), title = doc.createElement('strong'), meta = doc.createElement('small'), content = doc.createElement('p');
            title.textContent = event.title;
            meta.textContent = `类型：${event.type} · 权重：${event.weight} · ${event.status === 'pending' ? '待用' : '可用'}`;
            content.textContent = event.content; item.append(title, meta, content); list.append(item);
        }
        if (!list.childElementCount) list.textContent = '暂无事件。';
    }
    const onChange = event => {
        const el = event.target, name = el.dataset.setting;
        if (!name) return;
        notice = '';
        try { director.update({ [name]: el.type === 'checkbox' ? el.checked : el.value }); refresh(); }
        catch (e) { director.fail(e); }
    };
    const onClick = async event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        const owner = director.state()?.owner;
        try {
            notice = '';
            const task = action === 'roll' ? director.rollNow() : director.refill(true);
            refresh();
            const done = await task;
            if (director.state()?.owner !== owner) { refresh(); return; }
            const state = director.state();
            notice = done ? (action === 'roll' ? '随机事件已准备，将在下一次正常生成时生效。' : '事件池已更新。')
                : state?.poolGenerated && !state.eventPool.length && !state.discussion.guide && !state.refillStopped
                    ? '事件池已用完，请等待更新回合，或手动更新事件池。' : '本次未准备新事件；正常聊天可继续。';
        } catch (e) { director.fail(e); }
        refresh();
    };
    const onInput = event => {
        const el = event.target;
        if (el.dataset.setting === 'fixedRoundInterval' && el.value !== '' && el.validity.valid) onChange(event);
    };
    root.addEventListener('change', onChange); root.addEventListener('input', onInput); root.addEventListener('click', onClick);
    field('pool').addEventListener('toggle', refresh);
    workspace = mountWorkspace(director, context, root, host, doc);
    refresh();
    return { refresh, dispose() { workspace.dispose(); connectionUI.dispose(); headerUI.dispose(); presetUI.dispose(); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); root.removeEventListener('click', onClick); root.remove(); } };
}
import { mountPresetUI } from './preset-ui.js';
import { mountConnectionUI } from './connection-ui.js';
import { mountHeaderUI } from './header-ui.js';
import { mountWorkspace } from './workspace-ui.js';
