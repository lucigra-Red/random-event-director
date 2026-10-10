// Fixed widgets follow the visible viewport, including a mobile keyboard or orientation change.
export function visibleViewport(win) {
    const v = win.visualViewport;
    return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0,
        width: v?.width || win.document.documentElement.clientWidth || win.innerWidth,
        height: v?.height || win.document.documentElement.clientHeight || win.innerHeight };
}

export function fitPosition(rect, viewport, margin = 8) {
    const x = viewport.left + margin, y = viewport.top + margin;
    return { left: Math.max(x, Math.min(rect.left, x + Math.max(0, viewport.width - margin * 2 - rect.width))),
        top: Math.max(y, Math.min(rect.top, y + Math.max(0, viewport.height - margin * 2 - rect.height))) };
}

export function placeWidget(element, preferred, { constrain = true } = {}) {
    if (element.hidden) return;
    const viewport = visibleViewport(element.ownerDocument.defaultView);
    element.style.setProperty('--red-visible-width', `${viewport.width}px`);
    element.style.setProperty('--red-visible-height', `${viewport.height}px`);
    const rect = element.getBoundingClientRect();
    const requested = { left: preferred?.left ?? rect.left, top: preferred?.top ?? rect.top,
        width: rect.width, height: rect.height };
    const position = constrain ? fitPosition(requested, viewport) : requested;
    Object.assign(element.style, { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' });
}

// A short tap still clicks. Only a real drag suppresses its following synthetic click.
export function makeDraggable(element, handle, { canDrag = () => true, ignoreButtons = true, constrain = () => true } = {}) {
    let drag = null, suppressClick = false;
    const start = event => {
        if (event.isPrimary === false || (event.button != null && event.button !== 0) || !canDrag()
            || (ignoreButtons && event.target.closest?.('button, input, textarea, select, a'))) return;
        suppressClick = false;
        const rect = element.getBoundingClientRect();
        drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
        try { handle.setPointerCapture(event.pointerId); } catch { /* Detached or unsupported capture: no state mutation. */ }
    };
    const move = event => {
        if (!drag || event.pointerId !== drag.pointer) return;
        const x = event.clientX - drag.x, y = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(x, y) < 6) return;
        drag.moved = true; suppressClick = true;
        placeWidget(element, { left: drag.left + x, top: drag.top + y }, { constrain: constrain() });
    };
    const end = event => {
        if (!drag || event.pointerId !== drag.pointer) return;
        drag = null;
        try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* Capture already ended. */ }
    };
    const click = event => {
        if (!suppressClick || event.detail === 0) return;
        suppressClick = false; event.preventDefault(); event.stopImmediatePropagation();
    };
    handle.addEventListener('pointerdown', start); handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    handle.addEventListener('lostpointercapture', end); handle.addEventListener('click', click, true);
    return () => {
        handle.removeEventListener('pointerdown', start); handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
        handle.removeEventListener('lostpointercapture', end); handle.removeEventListener('click', click, true);
    };
}
