import { isPersona, normalizePersona } from './personas.js';
const checked = new WeakSet();
const bounded = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
export function discussionState(state, defaultPersona) {
    if (state.discussion && checked.has(state.discussion)) return state.discussion;
    const raw = state.discussion || {};
    const messages = Array.isArray(raw.messages) ? raw.messages.slice(-40).filter(m => m && ['user', 'assistant'].includes(m.role))
        .map(m => ({ id: bounded(m.id, 100), role: m.role, content: bounded(m.content, 6000),
            ...(m.role === 'assistant' && isPersona(m.persona) ? { persona: m.persona } : {}) })).filter(m => m.content) : [];
    const proposal = raw.proposal?.id && raw.proposal?.summary ? { id: bounded(raw.proposal.id, 100), summary: bounded(raw.proposal.summary, 2000) } : null;
    const guide = raw.guide?.id && raw.guide?.summary ? { id: bounded(raw.guide.id, 100), summary: bounded(raw.guide.summary, 2000),
        majorId: bounded(raw.guide.majorId, 100) || null,
        pool: (Array.isArray(raw.guide.pool) ? raw.guide.pool : []).slice(0, 6).filter(e => e?.id && e.title && e.content)
            .map(e => ({ id: bounded(e.id, 100), title: bounded(e.title, 100), content: bounded(e.content, 1200), type: bounded(e.type, 40),
                weight: Math.min(100, Math.max(1, Math.round(Number(e.weight) || 10))),
                severity: e.severity === 'major' ? 'major' : 'ordinary', status: 'available' })) } : null;
    state.discussion = { persona: normalizePersona(raw.persona, defaultPersona), messages, proposal, guide, lastUsed: bounded(raw.lastUsed, 2000), error: bounded(raw.error, 300) };
    checked.add(state.discussion); return state.discussion;
}
