import { activeHeader, nativePreset, nativeHeaderReference, builtinHeaderReference, BUILTIN_HEADER_TEXT } from './headers.js';
import { completionPresets } from './api.js';

export function mountHeaderUI(host, director, context, doc) {
    host.innerHTML = `<details class="red-headers"><summary>副 AI 头部预设</summary><div class="red-body">
      <p data-header-role="active"></p><label class="red-column">头部方式<select class="text_pole" data-header="mode">
      <option value="builtin">使用初月提供的头部</option><option value="native">使用酒馆预设</option><option value="none">不使用头部</option></select></label>
      <p class="red-help" data-header-role="help"></p>
      <details data-header-role="builtin" hidden><summary>查看初月头部内容</summary><textarea class="text_pole" rows="6" readonly aria-label="初月头部内容"></textarea></details>
      <div data-header-role="native" hidden><label class="red-column">选择酒馆预设<select class="text_pole" data-header="selected"></select></label>
      <p class="red-help">直接复用酒馆预设已启用的提示词及生成参数。预设的添加和编辑在酒馆中操作。</p>
      <button type="button" class="menu_button" data-header-action="refresh">刷新酒馆预设列表</button></div>
      <div class="red-actions"><button type="button" class="menu_button" data-header-action="apply">应用头部预设</button></div>
      <p data-header-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-headers'), select = root.querySelector('[data-header="selected"]');
    const modeSelect = root.querySelector('[data-header="mode"]');
    root.querySelector('[aria-label="初月头部内容"]').value = BUILTIN_HEADER_TEXT;
    const notice = text => { root.querySelector('[data-header-role="notice"]').textContent = text; };
    let mode = 'builtin', selected = '', owner = null, serial = '', catalogKey = '', disposed = false;
    function showMode() {
        const scope = director.state() ? '用于当前聊天' : '保存为新聊天默认值';
        modeSelect.value = mode;
        root.querySelector('[data-header-role="native"]').hidden = mode !== 'native';
        root.querySelector('[data-header-role="builtin"]').hidden = mode !== 'builtin';
        root.querySelector('[data-header-role="help"]').textContent = mode === 'builtin'
            ? `初月提供的导演头部，包含身份、性格、态度、使命和打招呼设定，用于剧情讨论和事件生成。点击应用后${scope}。`
            : mode === 'native' ? `选取一个酒馆已有预设，用于剧情讨论和事件生成。点击应用后${scope}。`
                : '不添加额外头部；初月的事件生成规则、小窗人设和讨论规则仍然有效。';
    }
    function refresh() {
        if (disposed) return;
        try {
            const chat = director.state(), state = director.settingsState(), active = activeHeader(state?.headerPreset), next = JSON.stringify(active);
            if (owner !== state?.owner || serial !== next) {
                owner = state?.owner; serial = next; selected = active?.nativePresetName || '';
                mode = active?.builtinHeader ? 'builtin' : active?.nativePresetName ? 'native' : 'none'; catalogKey = ''; notice('');
            }
            const legacy = active && !active.nativePresetName && !active.builtinHeader;
            root.querySelector('[data-header-role="active"]').textContent = legacy
                ? `当前仍使用旧版头部：${active.name}。请选择以下三种方式之一并应用。`
                : `${chat ? '当前头部' : '新聊天默认头部'}：${active?.builtinHeader ? active.name : active?.nativePresetName || '不使用头部'}`;
            showMode();
            // The built-in and disabled modes do not depend on the host's preset catalog.
            const names = mode === 'native' ? completionPresets(context(), 'openai') : [], key = JSON.stringify([names, selected]);
            if (key !== catalogKey) {
                const rows = [{ value: '', name: '请选择酒馆预设' }, ...names.map(name => ({ value: name, name }))];
                if (selected && !names.includes(selected)) rows.push({ value: selected, name: `${selected}（酒馆中已不存在）` });
                select.replaceChildren();
                for (const row of rows) { const option = doc.createElement('option'); option.value = row.value; option.textContent = row.name; select.append(option); }
                select.value = selected; catalogKey = key;
            }
            for (const control of root.querySelectorAll('select,button')) control.disabled = !state || director.busy;
        } catch (e) { notice(e.message); }
    }
    const change = event => {
        if (event.target === modeSelect) { mode = modeSelect.value; refresh(); }
        else if (event.target === select) selected = select.value;
        else return;
        notice(director.state() ? '点击“应用头部预设”后用于当前聊天。' : '点击“应用头部预设”后保存为新聊天默认头部。');
    };
    const click = event => {
        const action = event.target.closest('[data-header-action]')?.dataset.headerAction;
        if (!action) return;
        try {
            if (action === 'refresh') { catalogKey = ''; refresh(); notice('酒馆预设列表已刷新。'); }
            else if (action === 'apply') {
                const reference = mode === 'builtin' ? builtinHeaderReference() : mode === 'native' ? nativeHeaderReference(selected) : null;
                if (mode === 'native') nativePreset(reference, context());
                director.applyHeader(reference); refresh(); notice(!director.state() ? '已保存新聊天的默认头部；已有聊天不变。'
                    : mode === 'builtin' ? '已应用初月头部，用于当前聊天的剧情讨论和事件生成。'
                    : mode === 'native' ? '已应用酒馆预设；提示词和参数随酒馆中保存的修改更新。' : '已关闭额外头部。');
            }
        } catch (e) { notice(e.message); }
    };
    root.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; root.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
