export function mountDiagnosticsUI(host, diagnostics, doc = document) {
    host.innerHTML = `<p class="red-settings-intro">运行诊断：自动查询全局、预设、当前角色卡的酒馆助手脚本，并记录实际请求和注入情况。启动、切换聊天和脚本变化时自动更新；捕获到脚本调用时记录名字和调用编号。启用列表与并发候选不代表请求来源，更不代表干扰证据；无法识别时标为未知。最近 1000 条，刷新清空；不记录脚本代码、变量、密钥或聊天正文。</p>
      <div class="red-log-controls"><label><input type="checkbox" data-log="record" checked>记录日志</label><label><input type="checkbox" data-log="current" checked>仅当前聊天</label><label><input type="checkbox" data-log="follow" checked>自动滚动</label></div>
      <div class="red-window-actions"><button type="button" data-log-action="copy">复制日志</button><button type="button" data-log-action="export">导出 JSON</button><button type="button" data-log-action="report">查看报告</button><button type="button" data-log-action="clear">清空日志</button></div>
      <p class="red-log-status" data-log-role="status" role="status"></p><textarea data-log-role="report" aria-label="可复制诊断报告" rows="8" readonly hidden></textarea><div class="red-log-list" data-log-role="list" role="log" aria-label="导演诊断日志" tabindex="0"></div>`;
    const field = key => host.querySelector(`[data-log="${key}"]`), list = host.querySelector('[data-log-role="list"]');
    const status = host.querySelector('[data-log-role="status"]');
    const report = host.querySelector('[data-log-role="report"]');
    const labels = { success: '通过', info: '记录', skip: '跳过', warn: '注意', error: '错误' };
    let disposed = false, notice = '', fingerprint = '';
    function refresh() {
        if (disposed || host.hidden || host.closest('[hidden]')) return;
        const rows = diagnostics?.list(field('current').checked) || [], key = JSON.stringify(rows);
        status.textContent = notice || `${diagnostics?.scope() || '未选聊天'} · ${rows.length} 条记录${diagnostics?.enabled === false ? ' · 已暂停' : ''}`;
        field('record').checked = diagnostics?.enabled !== false;
        if (!report.hidden) report.value = diagnostics?.export(field('current').checked) || '';
        if (key === fingerprint) return; fingerprint = key;
        const following = field('follow').checked, previous = list.scrollTop;
        list.replaceChildren();
        for (const row of rows) {
            const item = doc.createElement('article'); item.className = `red-log-row red-log-${row.status}`;
            const meta = doc.createElement('small'), title = doc.createElement('strong'), message = doc.createElement('p');
            meta.textContent = `${new Date(row.time).toLocaleTimeString()} · ${row.scope}${row.run ? ` · ${row.run}` : ''}`;
            title.textContent = `${labels[row.status] || '记录'} · ${row.stage}`; message.textContent = row.message;
            item.append(meta, title, message);
            if (Object.keys(row.details).length) { const detail = doc.createElement('code'); detail.textContent = JSON.stringify(row.details); item.append(detail); }
            list.append(item);
        }
        if (!rows.length) { const empty = doc.createElement('p'); empty.textContent = '暂无记录。请开启当前聊天的导演，准备事件，再正常发送一条消息。'; list.append(empty); }
        list.scrollTop = following ? list.scrollHeight : previous;
    }
    const change = event => {
        notice = '';
        if (event.target === field('record') && diagnostics) {
            diagnostics.enabled = event.target.checked;
            if (diagnostics.enabled) diagnostics.refreshScripts?.();
        }
        fingerprint = ''; refresh();
    };
    const click = async event => {
        const action = event.target.closest('[data-log-action]')?.dataset.logAction;
        if (!action || !diagnostics) return;
        try {
            notice = '';
            if (action === 'clear') { diagnostics.clear(field('current').checked); diagnostics.refreshScripts?.(); }
            else if (action === 'report') { report.hidden = !report.hidden; if (!report.hidden) { report.value = diagnostics.export(field('current').checked); report.focus(); report.select(); } }
            else if (action === 'copy') {
                await doc.defaultView.navigator.clipboard.writeText(diagnostics.export(field('current').checked)); notice = '诊断日志已复制。';
            } else if (action === 'export') {
                const url = URL.createObjectURL(new Blob([diagnostics.export(field('current').checked)], { type: 'application/json' }));
                const link = doc.createElement('a'); link.href = url; link.download = '初月-诊断日志.json'; doc.body.append(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000); notice = '已发起 JSON 下载；也可复制日志或查看报告。';
            }
        } catch { report.hidden = false; report.value = diagnostics.export(field('current').checked); report.focus(); report.select(); notice = '浏览器未完成操作；可从报告框手动复制。'; }
        refresh();
    };
    host.addEventListener('change', change); host.addEventListener('click', click);
    const unsubscribe = diagnostics?.subscribe(refresh); refresh();
    return { refresh, dispose() { disposed = true; unsubscribe?.(); host.removeEventListener('change', change); host.removeEventListener('click', click); } };
}
