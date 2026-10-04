import { activeHeader, normalizeHeader, headerFromNative } from './headers.js';
import { completionPresets } from './api.js';

export function mountHeaderUI(host, director, context, doc) {
    host.innerHTML = `<details class="red-headers"><summary>副 AI 头部预设</summary><div class="red-body">
      <p data-header-role="active"></p><label class="red-column">选择头部预设<select class="text_pole" data-header="selected"></select></label>
      <p class="red-help">可选择酒馆已有预设，前置提示词和生成参数一起载入；点击应用后生效。</p>
      <label class="red-column">头部预设名称<input class="text_pole" maxlength="80" data-header="name"></label>
      <label class="red-column">副 AI 前置提示词<textarea class="text_pole" rows="5" data-header="content" placeholder="填写希望放在事件生成提示词之前的要求"></textarea></label>
      <details><summary>生成参数（可选）</summary><div class="red-grid">
        <label>温度<input class="text_pole" type="number" min="0" max="2" step="0.05" data-header="temperature" placeholder="默认 0.8"></label>
        <label>Top P<input class="text_pole" type="number" min="0" max="1" step="0.05" data-header="top_p" placeholder="留空使用默认"></label>
        <label>最大输出 tokens<input class="text_pole" type="number" min="128" max="32768" step="1" data-header="max_tokens" placeholder="默认 2200"></label>
      </div></details>
      <div class="red-actions"><button type="button" class="menu_button" data-header-action="apply">应用头部预设</button><button type="button" class="menu_button" data-header-action="save">保存头部预设</button>
      <button type="button" class="menu_button" data-header-action="new">添加头部预设</button><button type="button" class="menu_button" data-header-action="delete">删除头部预设</button></div>
      <label class="red-column">导入头部预设文件<input type="file" accept=".json,application/json" data-header="file"></label>
      <p class="red-help">支持酒馆聊天补全预设 JSON。导入已开启的文本提示词和参数，历史和角色资料由当前聊天提供。关键世界书设定可填写到“补充世界观”。</p>
      <details><summary>头部预设 JSON</summary><div class="red-body"><label class="red-column">头部预设 JSON 文本<textarea class="text_pole" rows="4" data-header="json" placeholder="可粘贴酒馆预设 JSON 或导演头部预设 JSON"></textarea></label>
      <div class="red-actions"><button type="button" class="menu_button" data-header-action="import">导入头部 JSON</button><button type="button" class="menu_button" data-header-action="export">导出头部 JSON</button></div></div></details>
      <p data-header-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-headers'), field = k => root.querySelector(`[data-header="${k}"]`);
    const notice = text => { root.querySelector('[data-header-role="notice"]').textContent = text; };
    let draft = null, selected = '', owner = null, serial = '', catalogKey = '', edited = false, disposed = false;
    const catalog = () => director.headers?.list() || [];
    function paint() {
        field('selected').value = selected; field('name').value = draft?.name || '';
        field('content').value = draft?.messages.map(m => m.content).join('\n\n') || '';
        for (const key of ['temperature', 'top_p', 'max_tokens']) field(key).value = draft?.generation?.[key] ?? '';
        edited = false;
    }
    function read() {
        const generation = { ...draft?.generation };
        for (const k of ['temperature', 'top_p', 'max_tokens']) { if (field(k).value === '') delete generation[k]; else generation[k] = field(k).value; }
        return normalizeHeader({ ...draft, name: field('name').value, generation,
            messages: !edited && draft ? draft.messages : [{ role: 'system', content: field('content').value }] });
    }
    function refresh() {
        if (disposed) return;
        try {
            const state = director.state(), active = activeHeader(state?.headerPreset), next = JSON.stringify(active);
            if (owner !== state?.owner || serial !== next) { owner = state?.owner; serial = next; draft = active; selected = active?.id || ''; catalogKey = ''; paint(); }
            root.querySelector('[data-header-role="active"]').textContent = `当前头部预设：${active?.name || '不使用头部预设'}`;
            const saved = catalog(); if (draft?.id && !saved.some(p => p.id === draft.id)) saved.push(draft);
            const native = completionPresets(context(), 'openai');
            const key = JSON.stringify([saved.map(p => [p.id, p.name]), native, selected]);
            if (key !== catalogKey) {
                field('selected').replaceChildren();
                const rows = [{ value: '', name: '不使用头部预设' }, ...saved.map(p => ({ value: p.id, name: p.name })),
                    ...native.map(name => ({ value: `native:${name}`, name: `酒馆：${name}` }))];
                if (selected === 'new') rows.push({ value: 'new', name: '新建头部预设（未保存）' });
                for (const row of rows) { const option = doc.createElement('option'); option.value = row.value; option.textContent = row.name; field('selected').append(option); }
                field('selected').value = selected; catalogKey = key;
            }
            for (const control of root.querySelectorAll('input,textarea,select,button')) control.disabled = !state || director.busy || !director.headers;
            root.querySelector('[data-header-action="delete"]').disabled ||= !draft?.id || !catalog().some(p => p.id === draft.id);
        } catch (e) { notice(e.message); }
    }
    function imported(text, name) { const p = director.headers.importJSON(text, name); catalogKey = ''; refresh(); draft = p; selected = p.id; refresh(); paint(); notice('头部预设已导入；点击“应用头部预设”后生效。'); }
    const input = event => { if (event.target.dataset.header === 'content') edited = true; };
    const change = async event => {
        try {
            if (event.target.dataset.header === 'selected') {
                selected = field('selected').value;
                if (selected.startsWith('native:')) {
                    const name = selected.slice(7), raw = context().getPresetManager?.('openai')?.getCompletionPresetByName?.(name);
                    draft = headerFromNative(raw, name, context().characterId);
                } else draft = selected ? catalog().find(p => p.id === selected) || draft : null;
                paint(); notice('已载入；点击应用或保存后生效。');
            } else if (event.target.dataset.header === 'file' && event.target.files?.[0]) {
                const file = event.target.files[0], origin = director.state()?.owner;
                if (file.size > 1500000) throw new Error('预设文件不能超过 1.5 MB');
                const text = await file.text(); if (disposed || director.state()?.owner !== origin) return;
                imported(text, file.name.replace(/\.json$/i, '')); event.target.value = '';
            }
        } catch (e) { notice(e.message); }
    };
    const click = event => {
        const action = event.target.closest('[data-header-action]')?.dataset.headerAction; if (!action) return;
        try {
            if (action === 'new') { draft = null; selected = 'new'; catalogKey = ''; refresh(); paint(); field('name').value = '新的头部预设'; field('name').focus(); notice('填写前置提示词后点击保存。'); }
            else if (action === 'apply') { director.applyHeader(selected === '' ? null : read()); refresh(); notice('头部预设及生成参数已应用。'); }
            else if (action === 'save') { draft = director.headers.save(read()); selected = draft.id; catalogKey = ''; director.applyHeader(draft); refresh(); paint(); notice('头部预设及参数已保存并应用。'); }
            else if (action === 'delete') { director.headers.remove(draft.id); director.applyHeader(null); draft = null; selected = ''; catalogKey = ''; refresh(); paint(); notice('已删除，当前聊天不再使用头部预设。'); }
            else if (action === 'import') imported(field('json').value, field('name').value || '导入的头部预设');
            else if (action === 'export') { field('json').value = director.headers.exportJSON(read()); notice('头部提示词和参数已导出到文本框。'); }
        } catch (e) { notice(e.message); }
    };
    root.addEventListener('input', input); root.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; root.removeEventListener('input', input); root.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
