/**
 * Action notifier — quiet "she did something" feedback.
 *
 * When Violet takes an action behind the scenes — saves a memory, sets a
 * reminder, schedules an event — a small glass card rises near her, the
 * icon sparks once like an unlocked achievement, then it fades on its own.
 *
 * Deliberately a DIFFERENT surface from modeNotifier (top-center, for
 * connection/mode warnings): this lives bottom-right, by the avatar, and is
 * celebratory rather than cautionary. Same dark-glass / amber language as the
 * chatbox and confirmation card so it reads as part of the avatar, not a
 * system popup.
 *
 * pointer-events: none — passive HUD over the click-through overlay.
 *
 * Usage:
 *   const n = mountActionNotifier();
 *   n.notify({ icon: 'reminder', title: 'Reminder set', detail: 'Dentist · Tue 3pm' });
 */

const STYLE_ID = 'persona-action-notifier-style';
const ROOT_ID  = 'persona-action-notifier';

const DISMISS_MS = 4200;
const MAX_VISIBLE = 4;

// Inline SVGs (stroke/fill use currentColor → they take the amber accent).
// Kept monochrome and minimal so they read as crisp glyphs, not emoji.
const ICONS = {
  // a four-point spark — "remembered"
  memory:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M12 2.5l1.7 6 6 1.7-6 1.7-1.7 6-1.7-6-6-1.7 6-1.7z"/></svg>',
  // a clock — "reminder"
  reminder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
  // a calendar — "event"
  event:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 9.5h16'
    + 'M8.5 3.5v4M15.5 3.5v4"/></svg>',
  // a minus-in-circle — "removed / forgotten"
  forget:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/></svg>',
};

function iconFor(name) {
  return ICONS[name] || ICONS.memory;
}

export function mountActionNotifier() {

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 26px;
        bottom: 104px;
        display: flex;
        flex-direction: column-reverse;  /* newest sits lowest, older rise */
        align-items: flex-end;
        gap: 10px;
        z-index: 999000;
        pointer-events: none;
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      #${ROOT_ID} .act {
        position: relative;
        display: flex;
        align-items: center;
        gap: 11px;
        min-width: 192px;
        max-width: 320px;
        padding: 11px 15px 11px 12px;
        background: rgba(20,20,25,0.78);
        border: 1px solid rgba(255,200,60,0.18);
        border-radius: 14px;
        box-shadow:
          0 0 0 1px rgba(255,200,60,0.04),
          0 14px 38px rgba(0,0,0,0.5);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        overflow: hidden;
        opacity: 0;
        transform: translateY(10px) scale(0.96);
        transition:
          opacity 0.28s ease,
          transform 0.34s cubic-bezier(0.16,1,0.3,1);
      }
      #${ROOT_ID} .act.in { opacity: 1; transform: none; }
      #${ROOT_ID} .act.out {
        opacity: 0;
        transform: translateY(4px) scale(0.98);
        transition: opacity 0.24s ease, transform 0.24s ease;
      }

      /* icon badge — the one bold element */
      #${ROOT_ID} .act-badge {
        position: relative;
        flex-shrink: 0;
        width: 30px; height: 30px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 9px;
        color: #ffc83c;
        background:
          linear-gradient(155deg, rgba(255,200,60,0.22), rgba(255,200,60,0.07));
        box-shadow: inset 0 0 0 1px rgba(255,200,60,0.22);
      }
      #${ROOT_ID} .act-badge svg { width: 16px; height: 16px; display: block; }
      #${ROOT_ID} .act.in .act-badge {
        animation: persona-badge-pop 0.5s cubic-bezier(0.16,1,0.3,1) both;
      }
      /* one-shot spark bloom behind the badge — the 'achievement' beat */
      #${ROOT_ID} .act-badge::after {
        content: '';
        position: absolute; inset: 0;
        border-radius: 9px;
        box-shadow: 0 0 0 0 rgba(255,200,60,0.45);
        opacity: 0;
      }
      #${ROOT_ID} .act.in .act-badge::after {
        animation: persona-badge-spark 0.72s ease-out 0.04s both;
      }

      #${ROOT_ID} .act-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      #${ROOT_ID} .act-title {
        font-size: 12.5px; font-weight: 600; letter-spacing: 0.01em;
        color: rgba(255,255,255,0.94);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #${ROOT_ID} .act-detail {
        font-size: 11px; line-height: 1.3;
        color: rgba(255,255,255,0.5);
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* whisper-thin auto-dismiss timer along the bottom edge */
      #${ROOT_ID} .act-timer {
        position: absolute; left: 0; bottom: 0; height: 1.5px;
        width: 100%;
        background: linear-gradient(90deg, rgba(255,200,60,0.7), rgba(255,200,60,0.15));
        transform-origin: left center;
      }
      #${ROOT_ID} .act.in .act-timer {
        animation: persona-act-timer ${DISMISS_MS}ms linear both;
      }

      @keyframes persona-badge-pop {
        0%   { transform: scale(0.6); }
        60%  { transform: scale(1.12); }
        100% { transform: scale(1); }
      }
      @keyframes persona-badge-spark {
        0%   { opacity: 0.55; box-shadow: 0 0 0 0 rgba(255,200,60,0.5); }
        100% { opacity: 0;    box-shadow: 0 0 0 16px rgba(255,200,60,0); }
      }
      @keyframes persona-act-timer {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
      }

      @media (prefers-reduced-motion: reduce) {
        #${ROOT_ID} .act,
        #${ROOT_ID} .act.in .act-badge,
        #${ROOT_ID} .act.in .act-badge::after { animation: none; transition: opacity 0.2s ease; }
      }
    `;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.appendChild(root);

  const dismiss = (card) => {
    if (card._dismissed) return;
    card._dismissed = true;
    if (card._timer) clearTimeout(card._timer);
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => { if (card.parentNode) card.remove(); }, 260);
  };

  const notify = ({ icon = 'memory', title = '', detail = '' } = {}) => {
    if (!title) return;

    const card = document.createElement('div');
    card.className = 'act';

    const badge = document.createElement('div');
    badge.className = 'act-badge';
    badge.innerHTML = iconFor(icon);

    const text = document.createElement('div');
    text.className = 'act-text';
    const t = document.createElement('div');
    t.className = 'act-title';
    t.textContent = title;
    text.appendChild(t);
    if (detail) {
      const d = document.createElement('div');
      d.className = 'act-detail';
      d.textContent = detail;
      text.appendChild(d);
    }

    const timer = document.createElement('div');
    timer.className = 'act-timer';

    card.append(badge, text, timer);
    root.appendChild(card);

    // Trim the stack so it never towers up the screen.
    while (root.children.length > MAX_VISIBLE) {
      dismiss(root.children[0]);
    }

    // next frame → trigger the entrance + spark.
    requestAnimationFrame(() => card.classList.add('in'));

    card._timer = setTimeout(() => dismiss(card), DISMISS_MS);
  };

  const destroy = () => { if (root.parentNode) root.remove(); };

  return { notify, destroy };
}
