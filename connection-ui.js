import { requestModels } from './api.js';

export function mountConnectionUI(host, director, doc) {
    host.innerHTML = `<details class="red-connection" open><summary>副 AI 连接</summary><div class="red-body">
      <label class="red-column">副 AI 连接方式<select class="text_pole" data-connection="mode"><option value="independent">独立配置地址与密钥</option><option value="current">使用当前酒馆连接</option></select></label>
      <div data-connection-role="own" class="red-body">
        <label class="red-column">副 AI API 地址<input class="text_pole" type="url" data-connection="endpoint" placeholder="https://example.com/v1" autocomplete="off"></label>
        <label class="red-column">副 AI API 密钥<input class="text_pole" type="password" data-connection="apiKey" placeholder="填写该地址对应的密钥；无需密钥时可留空" autocomplete="new-password" spellcheck="false"></label>
        <label class="red-column">独立副 AI 模型 ID<input class="text_pole" data-connection="model" placeholder="填写 API 提供方的模型 ID" autocomplete="off"></label>
        <div class="red-actions"><button type="button" class="menu_button" data-connection-action="models">拉取模型</button></div>
        <label class="red-column">选择模型<select class="text_pole" data-connection-role="models"><option value="">先拉取模型，或在上方手动填写</option></select></label>
        <p class="red-help">拉取使用上方填写的地址和密钥。选择模型后点击保存；无需先填写模型 ID。</p>
        <p class="red-help">支持 OpenAI 兼容接口。配置保存到酒馆扩展设置，密钥不随导演或头部预设导出。</p>
      </div><label class="checkbox_label"><input type="checkbox" data-connection="excludeSampling">排除温度与采样参数（兼容模式）</label>
      <p class="red-help">勾选后，副 AI 的事件生成和小窗讨论不发送 presence_penalty、frequency_penalty、top_p、top_k、temperature 及 reasoning_effort（推理强度），使用接口默认值。仅影响副 AI，勾选立即保存。</p>
      <button type="button" class="menu_button" data-connection-action="save">保存副 AI 配置</button>
      <p class="red-help">连接方式切换后立即生效。使用当前酒馆连接时，直接沿用主 API 的地址与密钥，无需填写副 API；独立地址、密钥和模型修改后请点击保存。</p><p data-connection-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-connection'), field = key => root.querySelector(`[data-connection="${key}"]`);
    const modelList = root.querySelector('[data-connection-role="models"]'), modelButton = root.querySelector('[data-connection-action="models"]');
    const notice = root.querySelector('[data-connection-role="notice"]');
    let fingerprint = '', disposed = false, modelRequest = null, modelSource = '';
    const source = () => JSON.stringify(['mode', 'endpoint', 'apiKey'].map(key => field(key).value));
    function invalidateModels() {
        modelRequest?.abort(); modelRequest = null; modelSource = '';
        modelList.replaceChildren(new Option('先拉取模型，或在上方手动填写', ''));
        modelButton.textContent = '拉取模型';
    }
    const display = () => { root.querySelector('[data-connection-role="own"]').hidden = field('mode').value !== 'independent'; };
    function refresh() {
        if (disposed) return;
        const config = director.connection?.read() || { mode: 'current', endpoint: '', apiKey: '', model: '' };
        const serial = JSON.stringify(config);
        if (serial !== fingerprint) {
            const previous = source();
            for (const key of ['mode', 'endpoint', 'apiKey', 'model']) field(key).value = config[key];
            field('excludeSampling').checked = config.excludeSampling === true;
            if (source() !== previous) invalidateModels();
            fingerprint = serial; display();
        }
        for (const control of root.querySelectorAll('input,select,button')) control.disabled = director.busy || !director.connection;
        modelButton.disabled ||= !!modelRequest;
        modelList.disabled ||= modelList.options.length <= 1;
    }
    const save = () => {
        try {
            director.applyConnection({ ...Object.fromEntries(['mode', 'endpoint', 'apiKey', 'model'].map(k => [k, field(k).value])),
                excludeSampling: field('excludeSampling').checked });
            refresh(); root.querySelector('[data-connection-role="notice"]').textContent = '副 AI 配置已保存。';
        } catch (e) {
            field('mode').value = director.connection?.read().mode || 'current'; display();
            root.querySelector('[data-connection-role="notice"]').textContent = e.message;
        }
    };
    async function loadModels() {
        if (modelRequest || director.busy || field('mode').value !== 'independent') return;
        invalidateModels();
        const controller = new AbortController(), captured = source();
        modelRequest = controller; modelButton.textContent = '正在拉取…'; notice.textContent = '正在拉取模型列表…'; refresh();
        try {
            const models = await requestModels(director.context(), Object.fromEntries(['mode', 'endpoint', 'apiKey'].map(key => [key, field(key).value])), controller.signal);
            if (disposed || controller.signal.aborted || source() !== captured) return;
            modelSource = captured;
            modelList.replaceChildren(new Option('请选择模型', ''), ...models.map(id => new Option(id, id)));
            modelList.value = models.includes(field('model').value) ? field('model').value : '';
            notice.textContent = `已拉取 ${models.length} 个模型。选择后请保存副 AI 配置。`;
        } catch (e) {
            if (!disposed && !controller.signal.aborted && source() === captured) notice.textContent = e.message;
        } finally {
            if (modelRequest === controller) { modelRequest = null; modelButton.textContent = '拉取模型'; refresh(); }
        }
    }
    const input = event => {
        if (['endpoint', 'apiKey'].includes(event.target.dataset.connection)) {
            invalidateModels(); notice.textContent = ''; refresh();
        } else if (event.target.dataset.connection === 'model') {
            modelList.value = field('model').value;
        }
    };
    const change = event => {
        if (event.target.dataset.connection === 'mode') { invalidateModels(); save(); }
        else if (event.target.dataset.connection === 'excludeSampling') save();
        else if (event.target === modelList && modelSource === source() && modelList.value) field('model').value = modelList.value;
    };
    const click = event => {
        if (event.target.closest('[data-connection-action="save"]')) save();
        else if (event.target.closest('[data-connection-action="models"]')) void loadModels();
    };
    root.addEventListener('input', input); root.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; invalidateModels(); root.removeEventListener('input', input); root.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
