export function mountUI(director, context, doc = document) {
    const host = doc.querySelector('#extensions_settings2') || doc.querySelector('#extensions_settings');
    if (!host) return null;
    doc.querySelector('#random_event_director_panel')?.remove();
    const root = doc.createElement('details');
    root.id = 'random_event_director_panel'; root.className = 'red-panel';
    root.innerHTML = `<summary>随机事件导演 <small>V0.1.8</small></summary>
      <div class="red-body">
      <p class="red-help">为当前聊天加入偶发情境。先配置副 AI，再开启随机事件。</p>
      <label><input type="checkbox" data-setting="enabled"> 开启本聊天的随机事件导演</label>
      <div class="red-grid">
        <label>随机事件概率（%）<input class="text_pole" type="number" min="0" max="100" data-setting="triggerProbability"></label>
        <label>近期消息数量<input class="text_pole" type="number" min="1" max="40" data-setting="contextMessages"></label>
      </div>
      <details><summary>高级设置</summary><div class="red-grid">
        <label>事件池目标数量<input class="text_pole" type="number" min="1" max="20" data-setting="targetCount"></label>
        <label>自动补充阈值<input class="text_pole" type="number" min="0" max="19" data-setting="refillThreshold"></label>
        <label>事件池保留回合<input class="text_pole" type="number" min="1" max="50" data-setting="expiryTurns"></label>
        <label>副 AI 超时（秒）<input class="text_pole" type="number" min="5" max="180" data-setting="timeoutSeconds"></label>
      </div></details>
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
        let s;
        try { s = director.state(); } catch (e) { field('status').textContent = e.message; return; }
        if (s?.owner !== lastOwner) { notice = ''; lastOwner = s?.owner; }
        if (!s?.pendingEvent && notice === '随机事件已准备，将在下一次正常生成时生效。') notice = '';
        for (const el of root.querySelectorAll('[data-setting]')) {
            const name = el.dataset.setting;
            el.disabled = !s || (name === 'model' && s.useCurrentModel);
            if (el.type === 'checkbox') el.checked = Boolean(s?.[name]);
            else if (doc.activeElement !== el) el.value = s?.[name] ?? '';
        }
        field('count').textContent = s ? `当前可用事件池：${s.eventPool.length} / ${s.targetCount}${director.fill ? ' · 副 AI 生成中…' : ''}` : '请先打开一个聊天。';
        field('pending').textContent = s?.pendingEvent ? '随机事件已准备，将在对应的下一次正常生成时生效。' : '当前没有待用事件。';
        field('recent').textContent = `最近触发：${s?.recentEvent?.title || '暂无'}`;
        field('status').textContent = s?.error || notice;
        for (const button of root.querySelectorAll('[data-action]')) button.disabled = !s?.enabled || director.busy || Boolean(director.fill);
        const list = root.querySelector('#red-models'); list.replaceChildren();
        const models = new Set();
        for (const select of doc.querySelectorAll('select[id*="model"]')) for (const option of select.options) {
            if (option.value && !option.disabled) models.add(option.value);
        }
        for (const model of models) { const option = doc.createElement('option'); option.value = model; list.append(option); }
        if (field('pool').open) showEvents(s);
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
            notice = done ? (action === 'roll' ? '随机事件已准备，将在下一次正常生成时生效。' : '事件池已更新。') : '本次未准备新事件；正常聊天可继续。';
        } catch (e) { director.fail(e); }
        refresh();
    };
    root.addEventListener('change', onChange); root.addEventListener('click', onClick);
    field('pool').addEventListener('toggle', refresh);
    workspace = mountWorkspace(director, context, root, host, doc);
    refresh();
    return { refresh, dispose() { workspace.dispose(); connectionUI.dispose(); headerUI.dispose(); presetUI.dispose(); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); root.remove(); } };
}
import { mountPresetUI } from './preset-ui.js';
import { mountConnectionUI } from './connection-ui.js';
import { mountHeaderUI } from './header-ui.js';
import { mountWorkspace } from './workspace-ui.js';
