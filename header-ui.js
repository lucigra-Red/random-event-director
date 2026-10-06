import { activeHeader, nativePreset, nativeHeaderReference } from './headers.js';
import { completionPresets } from './api.js';

export function mountHeaderUI(host, director, context, doc) {
    host.innerHTML = `<details class="red-headers"><summary>副 AI 头部预设</summary><div class="red-body">
      <p data-header-role="active"></p><label class="red-column">选择酒馆预设<select class="text_pole" data-header="selected"></select></label>
      <p class="red-help">直接复用酒馆聊天补全预设的已启用提示词及生成参数，用于剧情讨论和事件生成。预设的添加、编辑和导入请在酒馆预设管理中操作。</p>
      <div class="red-actions"><button type="button" class="menu_button" data-header-action="apply">应用头部预设</button><button type="button" class="menu_button" data-header-action="refresh">刷新酒馆预设列表</button></div>
      <p data-header-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-headers'), select = root.querySelector('[data-header="selected"]');
    const notice = text => { root.querySelector('[data-header-role="notice"]').textContent = text; };
    let selected = '', owner = null, serial = '', catalogKey = '', disposed = false;
    function refresh() {
        if (disposed) return;
        try {
            const state = director.state(), active = activeHeader(state?.headerPreset), next = JSON.stringify(active);
            if (owner !== state?.owner || serial !== next) {
                owner = state?.owner; serial = next; selected = active?.nativePresetName || ''; catalogKey = ''; notice('');
            }
            const legacy = active && !active.nativePresetName;
            root.querySelector('[data-header-role="active"]').textContent = legacy
                ? `当前仍使用旧版头部：${active.name}。请选择酒馆预设并应用。`
                : `当前酒馆头部预设：${active?.nativePresetName || '不使用头部预设'}`;
            const names = completionPresets(context(), 'openai'), key = JSON.stringify([names, selected]);
            if (key !== catalogKey) {
                const rows = [{ value: '', name: '不使用头部预设' }, ...names.map(name => ({ value: name, name }))];
                if (selected && !names.includes(selected)) rows.push({ value: selected, name: `${selected}（酒馆中已不存在）` });
                select.replaceChildren();
                for (const row of rows) { const option = doc.createElement('option'); option.value = row.value; option.textContent = row.name; select.append(option); }
                select.value = selected; catalogKey = key;
            }
            for (const control of root.querySelectorAll('select,button')) control.disabled = !state || director.busy;
        } catch (e) { notice(e.message); }
    }
    const change = () => { selected = select.value; notice('点击“应用头部预设”后用于当前聊天；之后的请求读取酒馆中最新保存的内容。'); };
    const click = event => {
        const action = event.target.closest('[data-header-action]')?.dataset.headerAction;
        if (!action) return;
        try {
            if (action === 'refresh') { catalogKey = ''; refresh(); notice('酒馆预设列表已刷新。'); }
            else if (action === 'apply') {
                const reference = selected ? nativeHeaderReference(selected) : null;
                if (reference) nativePreset(reference, context());
                director.applyHeader(reference); refresh(); notice(reference ? '已应用酒馆预设；提示词和参数随酒馆中保存的修改更新。' : '已关闭头部预设。');
            }
        } catch (e) { notice(e.message); }
    };
    select.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; select.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
