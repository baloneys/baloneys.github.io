// A DM window on each game. The embedded chat stays loaded while closed so its
// peer connection can deliver the shared IndexedDB outbox when a friend returns.
(function () {
  'use strict';
  if (!document.documentElement.dataset.game) return;
  // The window shows this game's public room as well as DMs (chat-public.js reads ?game=).
  const GAME_NAME = { tetris: 'Tetris', pong: 'Pong', battleships: 'Battleships', chess: 'Chess' }[document.documentElement.dataset.game] || 'Game';
  const dock = document.createElement('aside');
  dock.className = 'game-chat-dock';
  dock.setAttribute('aria-label', 'Direct messages');
  dock.innerHTML = '<div class="game-chat-panel" id="gameChatPanel"><div class="game-chat-head"><span class="game-chat-orb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 20l.9-4.5A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke-width="2.6"/></svg></span><span><b>Chat</b><small>' + GAME_NAME + ' room and messages</small></span><a href="chat.html" target="_blank" rel="noopener" title="Open full chat" aria-label="Open full chat">↗</a><button type="button" class="game-chat-close" aria-label="Close messages">×</button></div><iframe title="Direct messages" src="chat.html?mini=1&game=' + encodeURIComponent(document.documentElement.dataset.game) + '" loading="eager"></iframe></div><button type="button" class="game-chat-bubble" aria-label="Open messages" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 20l.9-4.5A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" stroke-width="2.6"/></svg><span class="game-chat-count" hidden></span></button>';
  document.body.appendChild(dock);
  const bubble = dock.querySelector('.game-chat-bubble');
  const panel = dock.querySelector('.game-chat-panel');
  const frame = dock.querySelector('iframe');
  const count = dock.querySelector('.game-chat-count');
  let pendingCode = null;
  function setOpen(open) {
    dock.classList.toggle('open', open);
    bubble.setAttribute('aria-expanded', String(open));
    bubble.setAttribute('aria-label', open ? 'Close messages' : 'Open messages');
    panel.setAttribute('aria-hidden', String(!open));
    if (frame.contentWindow) frame.contentWindow.postMessage(open ? 'chat:open' : 'chat:close', location.origin);
  }
  setOpen(false);
  bubble.addEventListener('click', () => setOpen(!dock.classList.contains('open')));
  dock.querySelector('.game-chat-close').addEventListener('click', () => setOpen(false));
  window.GameChatDock = { openTo: function (code) {
    pendingCode = code;
    setOpen(true);
    if (frame.contentWindow && frame.contentDocument && frame.contentDocument.readyState === 'complete') {
      frame.contentWindow.postMessage({ type: 'chat:open-contact', code: code }, location.origin);
      pendingCode = null;
    }
  } };
  frame.addEventListener('load', () => {
    if (!dock.classList.contains('open') || !frame.contentWindow) return;
    frame.contentWindow.postMessage('chat:open', location.origin);
    if (pendingCode) { frame.contentWindow.postMessage({ type: 'chat:open-contact', code: pendingCode }, location.origin); pendingCode = null; }
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (!event.data || event.data.type !== 'chat:unread') return;
    const n = Math.max(0, Math.min(99, Number(event.data.count) || 0));
    count.hidden = !n;
    count.textContent = n > 9 ? '9+' : String(n);
    bubble.classList.toggle('has-unread', n > 0);
  });
})();
