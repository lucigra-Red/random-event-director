import { DEFAULT_PRESET, BUILTIN_PRESETS, activePreset, normalizePreset } from './presets.js';

export function mountPresetUI(host, director, context, doc) {
    host.innerHTML = `<details class="red-presets"><summary>导演预设管理</summary>
      <div class="red-body"><p data-preset-role="active"></p>
      <label class="red-column">选择预设<select class="text_pole" data-preset-field="selected"></select></label>
      <div class="red-actions"><button type="button" class="menu_button" data-preset-action="import">导入 JSON</button></div>
      <input type="file" accept=".json,application/json" data-preset-field="file" hidden>
      <p class="red-help" data-preset-role="scope"></p>
      <p data-preset-role="notice" aria-live="polite"></p>
      <label class="red-column">预设名称<input class="text_pole" data-preset-field="name" maxlength="80"></label>
      <label class="red-column">副 AI 事件生成提示词<textarea class="text_pole" rows="7" data-preset-field="generatorPrompt"></textarea></label>
      <label class="red-column">主 AI 隐藏注入模板<textarea class="text_pole" rows="7" data-preset-field="injectionTemplate"></textarea></label>
      <p class="red-help">副 AI 必须含 {{count}}，注入模板必须含 {{event}}。可用：{{char}}、{{user}}；注入还可用 {{title}}、{{type}}。固定 JSON 输出协议与“不预定结果/玩家行动、不公开隐藏系统”规则始终保留。</p>
      <div class="red-actions"><button type="button" class="menu_button" data-preset-action="apply">应用到本聊天</button>
      <button type="button" class="menu_button" data-preset-action="save">保存预设</button>
      <button type="button" class="menu_button" data-preset-action="copy">另存为</button>
      <button type="button" class="menu_button" data-preset-action="reset">恢复默认</button>
      <button type="button" class="menu_button" data-preset-action="delete">删除选中预设</button></div>
      <details><summary>导出 JSON</summary><div class="red-body">
      <div class="red-actions"><button type="button" class="menu_button" data-preset-action="export">导出选中</button>
      <button type="button" class="menu_button" data-preset-action="export-all">导出全部自定义预设</button>
      <button type="button" class="menu_button" data-preset-action="download">下载 JSON</button></div>
      <label class="red-column">导出内容<textarea class="text_pole" rows="6" data-preset-field="json" readonly placeholder="点击上方导出按钮生成 JSON，可复制或下载"></textarea></label>
      </div></details><div class="red-add"><button type="button" class="menu_button" data-preset-action="new">添加自定义导演预设</button>
      <p class="red-help">创建一个新预设，在上方填写名称和提示词，再点击保存。</p></div>
      </div></details>`;
    const root = host.querySelector('.red-presets'), get = key => root.querySelector(`[data-preset-field="${key}"]`);
    const role = key => root.querySelector(`[data-preset-role="${key}"]`);
    let draft = { ...DEFAULT_PRESET }, owner = null, snapshot = '', disposed = false;
    let libraryFingerprint = '';
    function options(select, rows, chosen) {
        select.replaceChildren();
        for (const row of rows) { const option = doc.createElement('option'); option.value = row.value; option.textContent = row.label; select.append(option); }
        select.value = chosen;
    }
    function paint() {
        for (const key of ['name', 'generatorPrompt', 'injectionTemplate']) get(key).value = draft[key];
        get('selected').value = draft.id;
    }
    function read() {
        return normalizePreset({ ...draft, name: get('name').value, generatorPrompt: get('generatorPrompt').value,
            injectionTemplate: get('injectionTemplate').value });
    }
    function catalog() { return director.presets?.list() || BUILTIN_PRESETS.map(p => ({ ...p })); }
    function refresh() {
        if (disposed) return;
        try {
            const chat = director.state(), state = director.settingsState(), active = activePreset(state?.directorPreset);
            const serial = JSON.stringify(active);
            if (owner !== state?.owner || snapshot !== serial) {
                draft = { ...active }; owner = state?.owner; snapshot = serial;
                role('notice').textContent = ''; libraryFingerprint = '';
                paint();
            }
            role('active').textContent = `${chat ? '当前聊天预设' : '新聊天默认预设'}：${active.name}`;
            root.querySelector('[data-preset-action="apply"]').textContent = chat ? '应用到本聊天' : '设为新聊天默认';
            role('scope').textContent = chat ? '预设库跨聊天共享；应用后只改变当前聊天，保留独立快照。'
                : '可以编辑、保存和导入导演预设。应用后用于尚未设置初月的新聊天，已有聊天保持原设置。';
            const presets = catalog();
            if (!presets.some(p => p.id === draft.id)) presets.push({ ...draft, name: `${draft.name}（聊天快照）` });
            const fingerprint = JSON.stringify(presets.map(p => [p.id, p.name]));
            if (fingerprint !== libraryFingerprint) {
                options(get('selected'), presets.map(p => ({ value: p.id, label: p.name })), draft.id); libraryFingerprint = fingerprint;
            }
            for (const control of root.querySelectorAll('[data-preset-field], [data-preset-action]')) {
                control.disabled = !state || director.busy;
                if (['save', 'copy', 'delete', 'import', 'export-all', 'new'].includes(control.dataset.presetAction) || control.dataset.presetField === 'file') control.disabled ||= !director.presets;
                if (control.dataset.presetAction === 'delete') control.disabled ||= BUILTIN_PRESETS.some(p => p.id === draft.id) || !catalog().some(p => p.id === draft.id);
            }
        } catch (e) { role('notice').textContent = e.message; }
    }
    function imported(text) {
        const items = director.presets.importJSON(text);
        libraryFingerprint = ''; refresh();
        role('notice').textContent = `已导入 ${items.length} 个预设；选择并应用后生效。`;
    }
    const change = async event => {
        const key = event.target.dataset.presetField;
        try {
            if (key === 'selected') {
                draft = { ...(catalog().find(p => p.id === get('selected').value) || draft) };
                refresh(); paint(); role('notice').textContent = director.state() ? '已载入编辑器；点击“应用到本聊天”后生效。' : '已载入编辑器；点击“设为新聊天默认”后生效。';
            } else if (key === 'file' && event.target.files?.[0]) {
                const file = event.target.files[0], origin = director.state()?.owner;
                try {
                    if (file.size > 1500000) throw new Error('预设文件不能超过 1.5 MB');
                    const source = await file.text();
                    if (disposed || director.state()?.owner !== origin) return;
                    imported(source);
                } finally { event.target.value = ''; }
            } else if (['name', 'generatorPrompt', 'injectionTemplate'].includes(key)) {
                draft[key] = event.target.value;
            }
        } catch (e) { role('notice').textContent = e.message; }
    };
    const click = event => {
        const action = event.target.closest('[data-preset-action]')?.dataset.presetAction;
        if (!action) return;
        try {
            if (action === 'new') {
                draft = { ...DEFAULT_PRESET, id: 'new', name: '新的导演预设' }; libraryFingerprint = '';
                refresh(); paint(); get('name').focus(); role('notice').textContent = '已新建草稿；修改名称和提示词后点击“保存预设”。';
            } else if (action === 'apply') {
                director.applyPreset(read()); refresh(); role('notice').textContent = director.state() ? '预设已应用。新事件池使用新规则，已准备事件及重生成保留原模板。' : '已保存新聊天默认预设；已有聊天不变。';
            } else if (action === 'save' || action === 'copy') {
                draft = director.presets.save(read(), action === 'copy'); libraryFingerprint = '';
                director.applyPreset(draft); refresh(); paint(); role('notice').textContent = `已保存并应用：${draft.name}`;
            } else if (action === 'reset') {
                director.applyPreset(DEFAULT_PRESET); refresh(); role('notice').textContent = '已恢复默认预设；自定义预设库仍保留。';
            } else if (action === 'delete') {
                director.presets.remove(draft.id); draft = activePreset(director.settingsState()?.directorPreset);
                libraryFingerprint = ''; refresh(); paint(); role('notice').textContent = '已从预设库删除；已保存的独立快照仍可继续使用。';
            } else if (action === 'export' || action === 'export-all') {
                get('json').value = director.presets.exportJSON(action === 'export' ? read() : null);
                role('notice').textContent = 'JSON 已写入下方文本框，可复制或下载。';
            } else if (action === 'import') get('file').click();
            else if (action === 'download') {
                const data = get('json').value || director.presets.exportJSON(read());
                const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
                const link = doc.createElement('a'); link.href = url; link.download = 'random-event-director-presets.json';
                root.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        } catch (e) { role('notice').textContent = e.message; }
    };
    root.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; root.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
