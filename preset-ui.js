import { DEFAULT_PRESET, activePreset, normalizePreset } from './presets.js';
import { completionPresets } from './api.js';

export function mountPresetUI(host, director, context, doc) {
    host.innerHTML = `<details class="red-presets"><summary>导演预设管理</summary>
      <div class="red-body"><p data-preset-role="active"></p>
      <label class="red-column">选择预设<select class="text_pole" data-preset-field="selected"></select></label>
      <p class="red-help">选择后载入编辑器；点击“应用到本聊天”才生效。预设库跨聊天共享，当前聊天保存独立快照。</p>
      <label class="red-column">预设名称<input class="text_pole" data-preset-field="name" maxlength="80"></label>
      <label class="red-column">副 AI 事件生成提示词<textarea class="text_pole" rows="7" data-preset-field="generatorPrompt"></textarea></label>
      <label class="red-column">主 AI 隐藏注入模板<textarea class="text_pole" rows="7" data-preset-field="injectionTemplate"></textarea></label>
      <p class="red-help">副 AI 必须含 {{count}}，注入模板必须含 {{event}}。可用：{{char}}、{{user}}；注入还可用 {{title}}、{{type}}。固定 JSON 输出协议与“不预定结果/玩家行动、不公开隐藏系统”规则始终保留。</p>
      <label class="red-column">副 AI 酒馆生成参数预设（可选）<select class="text_pole" data-preset-field="completionPresetName"></select></label>
      <p class="red-help">使用该预设的生成参数，不切换主聊天配置。导演提示词由上面的编辑器提供，不导入整套主聊天提示词链。</p>
      <div class="red-actions"><button type="button" class="menu_button" data-preset-action="apply">应用到本聊天</button>
      <button type="button" class="menu_button" data-preset-action="save">保存预设</button>
      <button type="button" class="menu_button" data-preset-action="copy">另存为</button>
      <button type="button" class="menu_button" data-preset-action="reset">恢复默认</button>
      <button type="button" class="menu_button" data-preset-action="delete">删除选中预设</button></div>
      <details><summary>导入 / 导出 JSON</summary><div class="red-body">
      <div class="red-actions"><button type="button" class="menu_button" data-preset-action="export">导出选中</button>
      <button type="button" class="menu_button" data-preset-action="export-all">导出全部自定义预设</button>
      <button type="button" class="menu_button" data-preset-action="download">下载 JSON</button></div>
      <label class="red-column">预设 JSON<textarea class="text_pole" rows="6" data-preset-field="json" placeholder="粘贴导演预设 JSON，或使用下面的文件导入"></textarea></label>
      <button type="button" class="menu_button" data-preset-action="import">导入上述 JSON</button>
      <label class="red-column">导入预设文件<input type="file" accept=".json,application/json" data-preset-field="file"></label>
      <p class="red-help">导入只新增，同名自动编号；不会覆盖已有预设或自动应用。默认预设可另存，不能覆盖或删除。</p>
      </div></details><p data-preset-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-presets'), get = key => root.querySelector(`[data-preset-field="${key}"]`);
    const role = key => root.querySelector(`[data-preset-role="${key}"]`);
    let draft = { ...DEFAULT_PRESET }, owner = null, snapshot = '', disposed = false;
    let libraryFingerprint = '', parameterFingerprint = '';
    function options(select, rows, chosen) {
        select.replaceChildren();
        for (const row of rows) { const option = doc.createElement('option'); option.value = row.value; option.textContent = row.label; select.append(option); }
        select.value = chosen;
    }
    function paint() {
        for (const key of ['name', 'generatorPrompt', 'injectionTemplate']) get(key).value = draft[key];
        get('selected').value = draft.id;
        get('completionPresetName').value = draft.completionPresetName;
    }
    function read() {
        return normalizePreset({ ...draft, name: get('name').value, generatorPrompt: get('generatorPrompt').value,
            injectionTemplate: get('injectionTemplate').value, completionPresetName: get('completionPresetName').value });
    }
    function catalog() { return director.presets?.list() || [{ ...DEFAULT_PRESET }]; }
    function refresh() {
        if (disposed) return;
        try {
            const state = director.state(), active = activePreset(state?.directorPreset);
            const serial = JSON.stringify(active);
            if (owner !== state?.owner || snapshot !== serial) {
                draft = { ...active }; owner = state?.owner; snapshot = serial;
                role('notice').textContent = ''; libraryFingerprint = ''; parameterFingerprint = '';
                paint();
            }
            role('active').textContent = `当前聊天预设：${active.name}`;
            const presets = catalog();
            if (!presets.some(p => p.id === draft.id)) presets.push({ ...draft, name: `${draft.name}（聊天快照）` });
            const fingerprint = JSON.stringify(presets.map(p => [p.id, p.name]));
            if (fingerprint !== libraryFingerprint) {
                options(get('selected'), presets.map(p => ({ value: p.id, label: p.name })), draft.id); libraryFingerprint = fingerprint;
            }
            const params = completionPresets(context());
            const paramKey = JSON.stringify([context().mainApi, params, draft.completionPresetName]);
            if (paramKey !== parameterFingerprint) {
                const rows = [{ value: '', label: '使用当前连接参数（默认温度 0.8）' }, ...params.map(name => ({ value: name, label: name }))];
                if (draft.completionPresetName && !params.includes(draft.completionPresetName)) rows.push({ value: draft.completionPresetName, label: `${draft.completionPresetName}（当前 API 未找到）` });
                options(get('completionPresetName'), rows, draft.completionPresetName); parameterFingerprint = paramKey;
            }
            for (const control of root.querySelectorAll('[data-preset-field], [data-preset-action]')) {
                control.disabled = !state || director.busy;
                if (['save', 'copy', 'delete', 'import', 'export-all'].includes(control.dataset.presetAction) || control.dataset.presetField === 'file') control.disabled ||= !director.presets;
                if (control.dataset.presetAction === 'delete') control.disabled ||= draft.id === DEFAULT_PRESET.id || !catalog().some(p => p.id === draft.id);
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
                parameterFingerprint = ''; refresh(); paint(); role('notice').textContent = '已载入编辑器；点击“应用到本聊天”后生效。';
            } else if (key === 'file' && event.target.files?.[0]) {
                const file = event.target.files[0], origin = director.state()?.owner;
                if (file.size > 1500000) throw new Error('预设文件不能超过 1.5 MB');
                const source = await file.text();
                if (disposed || director.state()?.owner !== origin) return;
                imported(source); event.target.value = '';
            } else if (['name', 'generatorPrompt', 'injectionTemplate', 'completionPresetName'].includes(key)) {
                draft[key] = event.target.value;
            }
        } catch (e) { role('notice').textContent = e.message; }
    };
    const click = event => {
        const action = event.target.closest('[data-preset-action]')?.dataset.presetAction;
        if (!action) return;
        try {
            if (action === 'apply') {
                director.applyPreset(read()); refresh(); role('notice').textContent = '预设已应用。新事件池使用新规则，已准备事件及重生成保留原模板。';
            } else if (action === 'save' || action === 'copy') {
                draft = director.presets.save(read(), action === 'copy'); libraryFingerprint = '';
                director.applyPreset(draft); refresh(); paint(); role('notice').textContent = `已保存并应用：${draft.name}`;
            } else if (action === 'reset') {
                director.applyPreset(DEFAULT_PRESET); refresh(); role('notice').textContent = '已恢复默认预设；自定义预设库仍保留。';
            } else if (action === 'delete') {
                director.presets.remove(draft.id); draft = activePreset(director.state()?.directorPreset);
                libraryFingerprint = ''; refresh(); paint(); role('notice').textContent = '已从预设库删除；当前聊天的独立快照仍可继续使用。';
            } else if (action === 'export' || action === 'export-all') {
                get('json').value = director.presets.exportJSON(action === 'export' ? read() : null);
                role('notice').textContent = 'JSON 已写入下方文本框，可复制或下载。';
            } else if (action === 'import') imported(get('json').value);
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
