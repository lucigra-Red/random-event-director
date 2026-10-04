export function mountConnectionUI(host, director, doc) {
    host.innerHTML = `<details class="red-connection" open><summary>副 AI 连接</summary><div class="red-body">
      <label class="red-column">副 AI 连接方式<select class="text_pole" data-connection="mode"><option value="independent">独立配置地址与密钥</option><option value="current">使用当前酒馆连接</option></select></label>
      <div data-connection-role="own" class="red-body">
        <label class="red-column">副 AI API 地址<input class="text_pole" type="url" data-connection="endpoint" placeholder="https://example.com/v1" autocomplete="off"></label>
        <label class="red-column">副 AI API 密钥<input class="text_pole" type="password" data-connection="apiKey" placeholder="填写该地址对应的密钥；无需密钥时可留空" autocomplete="new-password" spellcheck="false"></label>
        <label class="red-column">独立副 AI 模型 ID<input class="text_pole" data-connection="model" placeholder="填写 API 提供方的模型 ID" autocomplete="off"></label>
        <p class="red-help">支持 OpenAI 兼容接口。配置保存到酒馆扩展设置，密钥不随导演或头部预设导出。</p>
      </div><button type="button" class="menu_button" data-connection-action="save">保存副 AI 配置</button>
      <p class="red-help">保存后用于所有聊天的副 AI；主聊天连接保持原设置。</p><p data-connection-role="notice" aria-live="polite"></p></div></details>`;
    const root = host.querySelector('.red-connection'), field = key => root.querySelector(`[data-connection="${key}"]`);
    let fingerprint = '', disposed = false;
    const display = () => { root.querySelector('[data-connection-role="own"]').hidden = field('mode').value !== 'independent'; };
    function refresh() {
        if (disposed) return;
        const config = director.connection?.read() || { mode: 'current', endpoint: '', apiKey: '', model: '' };
        const serial = JSON.stringify(config);
        if (serial !== fingerprint) { for (const key of ['mode', 'endpoint', 'apiKey', 'model']) field(key).value = config[key]; fingerprint = serial; display(); }
        for (const control of root.querySelectorAll('input,select,button')) control.disabled = director.busy || !director.connection;
    }
    const change = event => { if (event.target.dataset.connection === 'mode') display(); };
    const click = event => {
        if (!event.target.closest('[data-connection-action="save"]')) return;
        try {
            director.applyConnection(Object.fromEntries(['mode', 'endpoint', 'apiKey', 'model'].map(k => [k, field(k).value])));
            refresh(); root.querySelector('[data-connection-role="notice"]').textContent = '副 AI 配置已保存。';
        } catch (e) { root.querySelector('[data-connection-role="notice"]').textContent = e.message; }
    };
    root.addEventListener('change', change); root.addEventListener('click', click); refresh();
    return { refresh, dispose() { disposed = true; root.removeEventListener('change', change); root.removeEventListener('click', click); root.remove(); } };
}
