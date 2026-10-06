import { UpdateChecker, ExtensionUpdater, CURRENT_VERSION } from './updates.js';

export function mountUpdateUI(window, entry, context, doc) {
    const section = doc.createElement('section'); section.className = 'red-update-settings';
    section.innerHTML = `<strong>版本与更新</strong><p>当前版本 v${CURRENT_VERSION}</p>
        <label><input type="checkbox" data-update="auto"> 打开导演窗口时自动检查更新</label>
        <p class="red-help">仅检查公开版本信息，不发送聊天或 API 配置。网络不可用时不影响使用。</p>
        <div class="red-update-actions"><button type="button" data-update="check">检查更新</button><button type="button" data-update="install">更新</button></div>
        <p data-update="status" role="status"></p><small>点击“更新”直接更新本扩展，成功后刷新页面生效。</small>`;
    window.querySelector('[data-page="settings"]').prepend(section);
    const banner = doc.createElement('div'); banner.className = 'red-update-banner'; banner.hidden = true;
    banner.innerHTML = `<span data-update="message" role="status"></span><button type="button" data-update="install">更新</button><button type="button" data-update="dismiss" aria-label="暂时关闭更新提醒">×</button>`;
    window.querySelector('.red-owner').before(banner);
    const badge = doc.createElement('small'); badge.className = 'red-update-badge'; badge.hidden = true; badge.textContent = '有更新';
    entry.querySelector('b').append(badge);
    const settingsTab = window.querySelector('[data-view="settings"]');
    const automatic = section.querySelector('[data-update="auto"]'), check = section.querySelector('[data-update="check"]');
    let dismissed = '', disposed = false;
    const checker = new UpdateChecker({ context, changed: refresh });
    const updater = new ExtensionUpdater({ context, changed: refresh });
    const installButtons = [section, banner].map(node => node.querySelector('[data-update="install"]'));
    function refresh() {
        if (disposed) return;
        const s = checker.state;
        automatic.checked = checker.autoEnabled(); automatic.disabled = !context().extensionSettings;
        check.disabled = s.checking || updater.state.updating || updater.state.done; check.textContent = s.checking ? '正在检查…' : '检查更新';
        for (const button of installButtons) {
            button.disabled = updater.state.updating || s.checking;
            button.textContent = updater.state.updating ? '正在更新…' : updater.state.done ? '刷新页面' : '更新';
        }
        badge.hidden = !s.available; settingsTab.classList.toggle('red-has-update', s.available);
        banner.hidden = (!s.available && !updater.state.message) || dismissed === (s.latest || 'update');
        banner.querySelector('[data-update="message"]').textContent = updater.state.message || (s.available ? `初月有新版本 v${s.latest}` : '');
        section.querySelector('[data-update="status"]').textContent = updater.state.message || (s.checking ? '正在检查更新…'
            : s.manualError ? '暂时无法检查更新，请稍后重试，或打开仓库查看。'
                : s.available ? `发现新版本 v${s.latest}`
                    : s.checked ? '当前版本已是最新。' : '');
    }
    const onAuto = () => checker.setAuto(automatic.checked);
    const onCheck = () => { dismissed = ''; updater.state.message = ''; void checker.check({ manual: true }); };
    const onInstall = () => {
        if (updater.state.updating || checker.state.checking) return;
        if (updater.state.done) { doc.defaultView.location.reload(); return; }
        dismissed = ''; void updater.update();
    };
    const onBanner = event => {
        const action = event.target.closest('[data-update]')?.dataset.update;
        if (action === 'dismiss') { dismissed = checker.state.latest || 'update'; refresh(); }
        if (action === 'install') onInstall();
    };
    automatic.addEventListener('change', onAuto); check.addEventListener('click', onCheck); banner.addEventListener('click', onBanner);
    installButtons[0].addEventListener('click', onInstall);
    refresh();
    return { opened() { void checker.check(); }, dispose() {
        disposed = true; checker.dispose(); updater.dispose();
        automatic.removeEventListener('change', onAuto); check.removeEventListener('click', onCheck); banner.removeEventListener('click', onBanner);
        installButtons[0].removeEventListener('click', onInstall);
        settingsTab.classList.remove('red-has-update'); section.remove(); banner.remove(); badge.remove();
    } };
}
