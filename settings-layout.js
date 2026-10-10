export function settingHelp(title, content) {
    return `<details class="red-setting-help"><summary aria-label="${title}说明"><span class="red-help-icon" aria-hidden="true">i</span>说明</summary><div class="red-help-content">${content}</div></details>`;
}

// Keep the existing help nodes (including live text) and their event handlers intact.
export function foldSettingsHelp(root) {
    const keepVisible = '[data-role="settings-scope"], [data-role="main-prompt-status"], [data-role="fixed-progress"]';
    for (const first of root.querySelectorAll('.red-help')) {
        if (first.closest('.red-setting-help') || first.matches(keepVisible)) continue;
        const detail = first.ownerDocument.createElement('details');
        detail.className = 'red-setting-help';
        detail.innerHTML = '<summary><span class="red-help-icon" aria-hidden="true">i</span>说明</summary><div class="red-help-content"></div>';
        first.before(detail);
        let next = first;
        while (next?.matches('.red-help') && !next.matches(keepVisible)) {
            const sibling = next.nextElementSibling;
            detail.lastElementChild.append(next); next = sibling;
        }
    }
}
