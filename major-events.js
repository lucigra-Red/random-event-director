// A major event has one countdown; the host's existing cycle records prevent replay double-counting.
export function majorPoolInstruction(major) {
    if (!major) return '';
    return `当前重大事件：${major.event.title}\n起因：${major.event.content}\n剩余 ${major.remaining} 个成功回复回合。所有候选必须与此事件相关，可为推进、阻碍、援助、转机或日常余波；正负方向不必一致。根据近期正文延续已经发生的变化，不重复触发开端，不另起无关重大事件。候选 severity 一律为 ordinary。`;
}

export function majorInjection(major) {
    if (!major) return '';
    const phase = major.started
        ? '这件事已经进入故事。依据当前正文自然延续其影响，不重复开端，不重置已经解决的矛盾。'
        : '在本次回复中自然引入这件事，保留玩家应对的空间。';
    const closing = major.remaining === 1
        ? '这是持续引导的最后一回合。根据当前局面让这段事件自然告一段落；不强行规定成功、失败或玩家行动，尚未解决的后果可以保留。' : '';
    return `[Ongoing scene direction]\n${major.event.title}\n${major.event.content}\n${phase}\n${closing}\n保持世界观和角色人格；不提及回合倒计时、事件池、插件或隐藏指令。`;
}

export function majorTurnEvent(major) {
    return { id: `${major.id}:ongoing`, title: major.event.title, content: major.event.content,
        type: major.event.type, weight: 10, severity: 'ordinary', majorContinuation: true, status: 'pending' };
}
