import { UpdateChecker, CURRENT_VERSION, REPOSITORY_URL } from './updates.js';

export function mountUpdateUI(window, entry, context, doc) {
    const section = doc.createElement('section'); section.className = 'red-update-settings';
    section.innerHTML = `<strong>版本与更新</strong><p>当前版本 v${CURRENT_VERSION}</p>
        <label><input type="checkbox" data-update="auto"> 打开导演窗口时自动检查更新</label>
        <p class="red-help">仅检查公开版本信息，不发送聊天或 API 配置。网络不可用时不影响使用。</p>
        <div class="red-update-actions"><button type="button" data-update="check">检查更新</button><a href="${REPOSITORY_URL}" target="_blank" rel="noopener noreferrer">查看更新</a></div>
        <p data-update="status" role="status"></p><small>有新版本时，在酒馆扩展管理中更新本扩展，完成后刷新页面。</small>`;
    window.querySelector('[data-page="settings"]').prepend(section);
    const banner = doc.createElement('div'); banner.className = 'red-update-banner'; banner.hidden = true;
    banner.innerHTML = `<span data-update="message"></span><button type="button" data-update="details">查看更新</button><button type="button" data-update="dismiss" aria-label="暂时关闭更新提醒">×</button>`;
    window.querySelector('.red-owner').before(banner);
    const badge = doc.createElement('small'); badge.className = 'red-update-badge'; badge.hidden = true; badge.textContent = '有更新';
    entry.querySelector('b').append(badge);
    const settingsTab = window.querySelector('[data-view="settings"]');
    const automatic = section.querySelector('[data-update="auto"]'), check = section.querySelector('[data-update="check"]');
    let dismissed = '', disposed = false;
    const checker = new UpdateChecker({ context, changed: refresh });
    function refresh() {
        if (disposed) return;
        const s = checker.state;
        automatic.checked = checker.autoEnabled(); automatic.disabled = !context().extensionSettings;
        check.disabled = s.checking; check.textContent = s.checking ? '正在检查…' : '检查更新';
        badge.hidden = !s.available; settingsTab.classList.toggle('red-has-update', s.available);
        banner.hidden = !s.available || dismissed === s.latest;
        banner.querySelector('[data-update="message"]').textContent = s.available ? `初月有新版本 v${s.latest}` : '';
        section.querySelector('[data-update="status"]').textContent = s.checking ? '正在检查更新…'
            : s.manualError ? '暂时无法检查更新，请稍后重试，或打开仓库查看。'
                : s.available ? `发现新版本 v${s.latest}`
                    : s.checked ? '当前版本已是最新。' : '';
    }
    const onAuto = () => checker.setAuto(automatic.checked);
    const onCheck = () => { dismissed = ''; void checker.check({ manual: true }); };
    const onBanner = event => {
        const action = event.target.closest('[data-update]')?.dataset.update;
        if (action === 'dismiss') { dismissed = checker.state.latest; refresh(); }
        if (action === 'details') settingsTab.click();
    };
    automatic.addEventListener('change', onAuto); check.addEventListener('click', onCheck); banner.addEventListener('click', onBanner);
    refresh();
    return { opened() { void checker.check(); }, dispose() {
        disposed = true; checker.dispose();
        automatic.removeEventListener('change', onAuto); check.removeEventListener('click', onCheck); banner.removeEventListener('click', onBanner);
        settingsTab.classList.remove('red-has-update'); section.remove(); banner.remove(); badge.remove();
    } };
}
