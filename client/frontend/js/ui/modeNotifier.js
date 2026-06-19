/**
 * Mode notifier — surfaces the full <-> basic mode transitions and other
 * fallback events to the user, in the same dark-glass language as the
 * voice indicator and confirmation card.
 *
 * Two surfaces:
 *   - a transient TOAST (top-center) for events: "Backend offline —
 *     basic GPT mode", "Backend online — full mode restored". Auto-hides;
 *     `sticky` keeps it up until the next notify (used for the no-API-key
 *     error so the user actually reads it).
 *   - a persistent PILL (top-center, under the toast slot) shown only
 *     while in basic mode, so the degraded state is always visible at a
 *     glance rather than only at the moment of transition.
 *
 * pointer-events: none throughout — these are passive HUD elements over
 * the click-through overlay and must never steal clicks from apps below.
 *
 * Usage:
 *   const notifier = mountModeNotifier();
 *   notifier.setMode('basic');                       // shows the pill
 *   notifier.notify('Backend offline.', { kind: 'warn' });
 *   notifier.setMode('full');                        // hides the pill
 */

const STYLE_ID = 'persona-mode-notifier-style';
const ROOT_ID  = 'persona-mode-notifier';

const KIND_COLORS = {
  // accent border + dot per event severity
  ok:    '#4ade80',
  warn:  '#f59e0b',
  error: '#ef4444',
  info:  '#9ca3af',
};

export function mountModeNotifier() {

  if (!document.getElementById(STYLE_ID)) {

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        z-index: 9999;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        pointer-events: none;
      }
      #${ROOT_ID} .mode-toast {
        display: flex;
        align-items: center;
        gap: 9px;
        max-width: 360px;
        padding: 9px 15px;
        background: rgba(18, 18, 22, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-left-width: 3px;
        border-radius: 12px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.92);
        opacity: 0;
        transform: translateY(-8px);
        transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.16,1,0.3,1);
      }
      #${ROOT_ID} .mode-toast.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      #${ROOT_ID} .mode-toast .mode-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      #${ROOT_ID} .mode-pill {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 5px 12px;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.4);
        border-radius: 999px;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
        color: rgba(255, 220, 150, 0.95);
      }
      #${ROOT_ID} .mode-pill.is-visible {
        display: flex;
      }
      #${ROOT_ID} .mode-pill .mode-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #f59e0b;
        animation: persona-mode-pulse 1.6s ease-in-out infinite;
      }
      @keyframes persona-mode-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.4; }
      }
    `;
    document.head.appendChild(style);

  }

  const root = document.createElement('div');
  root.id = ROOT_ID;

  // Transient toast.
  const toast = document.createElement('div');
  toast.className = 'mode-toast';
  const toastDot = document.createElement('div');
  toastDot.className = 'mode-dot';
  const toastLabel = document.createElement('span');
  toast.appendChild(toastDot);
  toast.appendChild(toastLabel);

  // Persistent basic-mode pill.
  const pill = document.createElement('div');
  pill.className = 'mode-pill';
  const pillDot = document.createElement('div');
  pillDot.className = 'mode-dot';
  const pillLabel = document.createElement('span');
  pillLabel.textContent = 'Basic mode — GPT fallback';
  pill.appendChild(pillDot);
  pill.appendChild(pillLabel);

  root.appendChild(toast);
  root.appendChild(pill);
  document.body.appendChild(root);

  let hideTimer = null;

  const notify = (message, opts = {}) => {

    const kind  = opts.kind || 'info';
    const color = KIND_COLORS[kind] || KIND_COLORS.info;

    toastLabel.textContent      = message;
    toastDot.style.background   = color;
    toast.style.borderLeftColor = color;
    toast.classList.add('is-visible');

    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }

    // Sticky toasts (e.g. the no-key error) stay until the next notify.
    if (!opts.sticky) {
      const ms = opts.durationMs || 4200;
      hideTimer = setTimeout(() => {
        toast.classList.remove('is-visible');
        hideTimer = null;
      }, ms);
    }

  };

  const setMode = (mode) => {
    if (mode === 'basic') {
      pill.classList.add('is-visible');
    } else {
      pill.classList.remove('is-visible');
    }
  };

  const destroy = () => {
    if (hideTimer) clearTimeout(hideTimer);
    if (root.parentNode) root.parentNode.removeChild(root);
  };

  return { notify, setMode, destroy };

}
