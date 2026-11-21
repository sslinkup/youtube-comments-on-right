// ==UserScript==
// @name         YouTube: Comments on the Right
// @namespace    https://github.com/sslinkup/youtube-comments-on-right
// @version      4.2.0
// @description  Moves comments next to the video, locks the page, and gives the right column its own scrollbar.
// @author       sslinkup
// @license      MIT
// @homepage     https://github.com/sslinkup/youtube-comments-on-right
// @source       https://github.com/sslinkup/youtube-comments-on-right/raw/main/youtube-comments-right.user.js
// @supportURL   https://github.com/sslinkup/youtube-comments-on-right/issues
// @match        https://www.youtube.com/watch*
// @match        https://youtube.com/watch*
// @grant        none
// @run-at       document-idle
// Security: no network requests, no storage access, no privileged APIs,
// no eval/innerHTML. Only moves a DOM node and injects static CSS.
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    sidebarWidth: 460,
    hideRecommendations: false,
    lockPage: true,            // stop the whole page from scrolling
    scrollableSidebar: true,   // right column scrolls independently
    topOffset: 56,             // YouTube masthead height in px
    showDebugBadge: false,     // set true to show the diagnostic badge
    descriptionScrollable: true,  // cap the description height and scroll it
    descriptionMaxHeight: 140,    // description box height in px
    expandDescription: true,      // auto-click "more" to show the full description
    playlistOnTop: true,          // move the playlist above the comments
    playlistItemsHeight: 160,     // height of the playlist's internal scroller in px
    pinnedComments: true,         // pin comments at top, scroll recommendations below
    commentsFlex: 1,              // relative height of the comments pane
    recsFlex: 1,                  // relative height of the recommendations pane
  };

  const COMMENT_SELECTORS = ['#comments', 'ytd-comments', 'ytd-comments-renderer'];
  const COLUMN_SELECTORS = ['#secondary', '#right-column', 'ytd-watch-next-secondary-results-renderer'];

  let applyTimer = null;
  let lastStatus = '';
  let lastDeepSearch = 0;
  const hiddenEls = new Set();

  function isWatchPage() {
    return /^\/watch\/?$/.test(location.pathname);
  }

  // YouTube navigates via AJAX, so our <style> would otherwise survive on
  // Home / Channel / Library pages and keep them from scrolling.
  function restorePage() {
    const style = document.getElementById('yt-comments-right-style');
    if (style) style.remove();
    const badge = document.getElementById('yt-comments-right-badge');
    if (badge) badge.remove();
    document.querySelectorAll('ytd-watch-flexy').forEach((f) => {
      f.style.removeProperty('--ytd-watch-flexy-sidebar-width');
    });
    hiddenEls.forEach((el) => { el.style.display = ''; });
    hiddenEls.clear();
    lastStatus = '';
  }

  // Trailing debounce: coalesce YouTube's burst of DOM mutations into one run.
  function scheduleApply() {
    if (applyTimer) return;
    applyTimer = setTimeout(() => {
      applyTimer = null;
      try { apply(); } catch (e) { status('ERROR: ' + e.message); console.error(e); }
    }, 300);
  }

  // The deep shadow-root search is only a fallback for redesigned layouts.
  // Rate-limit it so a broken layout can't cause a full DOM walk every tick.
  function deepFindLimited(root, selectors) {
    const now = Date.now();
    if (now - lastDeepSearch < 5000) return null;
    lastDeepSearch = now;
    return deepFind(root, selectors);
  }

  function status(msg) {
    lastStatus = msg;
    console.log('[comments-right]', msg);
    if (!CONFIG.showDebugBadge) return;
    let badge = document.getElementById('yt-comments-right-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'yt-comments-right-badge';
      badge.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:99999;background:#111;color:#0f0;font:12px monospace;padding:6px 10px;border-radius:6px;opacity:.9;max-width:420px;';
      document.body.appendChild(badge);
    }
    badge.textContent = 'comments→right: ' + msg;
  }

  // Find an element via selectors, descending into every shadow root if needed.
  function deepFind(root, selectors, depth) {
    depth = depth || 0;
    if (!root || depth > 8) return null;
    for (const sel of selectors) {
      let el;
      try { el = root.querySelector(sel); } catch (e) { continue; }
      if (el) return el;
    }
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const hit = deepFind(el.shadowRoot, selectors, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  function injectStyle(root) {
    if (!root || root.querySelector('#yt-comments-right-style')) return;
    const style = document.createElement('style');
    style.id = 'yt-comments-right-style';
    const columnHeight = `calc(100vh - ${CONFIG.topOffset}px)`;

    style.textContent = `
      ${CONFIG.lockPage ? `
      html, body { overflow: hidden !important; height: 100% !important; }
      /* Confine the watch page to the viewport so it can never scroll. */
      ytd-watch-flexy {
        height: ${columnHeight} !important;
        overflow: hidden !important;
      }
      ` : ''}
      ytd-watch-flexy { --ytd-watch-flexy-sidebar-width: ${CONFIG.sidebarWidth}px !important; }

      ${CONFIG.scrollableSidebar ? `
      #secondary-inner {
        height: ${columnHeight} !important;
        max-height: ${columnHeight} !important;
        ${CONFIG.pinnedComments ? `
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        ` : `
        overflow-y: auto !important;
        overflow-x: hidden !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        `}
      }
      ${CONFIG.pinnedComments ? `
      #secondary-inner > ytd-playlist-panel-renderer#playlist {
        flex: 0 0 auto !important;
        order: 0;
      }
      #secondary-inner > #comments {
        flex: ${CONFIG.commentsFlex} 1 0 !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        order: 1;
      }
      ${CONFIG.hideRecommendations ? '' : `
      #secondary-inner > #related {
        flex: ${CONFIG.recsFlex} 1 0 !important;
        min-height: 0 !important;
        overflow-y: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
        order: 2;
      }
      `}
      #secondary-inner > :not(#comments):not(#related):not(ytd-playlist-panel-renderer#playlist) {
        display: none !important;
      }
      ` : ''}
      ` : ''}

      #secondary-inner #comments { margin-top: 0 !important; }

      ${CONFIG.descriptionScrollable ? `
      #description-inner {
        max-height: ${CONFIG.descriptionMaxHeight}px !important;
        overflow-y: auto !important;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      ` : ''}

      ${CONFIG.playlistOnTop ? `
      ytd-playlist-panel-renderer#playlist #items {
        max-height: ${CONFIG.playlistItemsHeight}px !important;
      }
      ` : ''}
    `;
    // A Document can't take appendChild() — styles belong in <head> there.
    const host = root === document ? (document.head || document.documentElement) : root;
    host.appendChild(style);
  }

  function apply() {
    if (!isWatchPage()) { restorePage(); return; }

    const flexy = document.querySelector('ytd-watch-flexy');
    if (!flexy) { status('waiting: no ytd-watch-flexy'); return; }

    // Current YouTube: everything is in the light DOM. Older versions: shadow DOM.
    const root = flexy.shadowRoot || document;

    let comments = root.querySelector('#comments') || root.querySelector('ytd-comments');
    let column = root.querySelector('#secondary');

    if (!comments) comments = deepFindLimited(document, COMMENT_SELECTORS);
    if (!column) column = deepFindLimited(document, COLUMN_SELECTORS);

    if (!comments) { status('waiting: comments not found'); return; }
    if (!column) { status('column #secondary NOT FOUND — structure changed'); return; }

    flexy.style.setProperty('--ytd-watch-flexy-sidebar-width', CONFIG.sidebarWidth + 'px');
    const styleRoot = column.getRootNode();
    injectStyle(styleRoot instanceof ShadowRoot ? styleRoot : document);

    // Prefer the inner box of the column so styling/scroll behaviour stays intact.
    const target = column.querySelector('#secondary-inner') || column;

    if (comments.parentElement !== target) {
      target.insertBefore(comments, target.firstChild);
    }

    // Expand the description once so its capped box actually has content to scroll.
    if (CONFIG.expandDescription) {
      const expand = root.querySelector('#description-inline-expander #expand');
      if (expand && expand.offsetParent !== null) expand.click();
    }

    // Put the playlist panel directly above the comments.
    if (CONFIG.playlistOnTop) {
      const playlist = root.querySelector('ytd-playlist-panel-renderer#playlist');
      if (playlist && (playlist.parentElement !== target || playlist.nextElementSibling !== comments)) {
        target.insertBefore(playlist, comments);
      }
    }

    if (CONFIG.hideRecommendations) {
      target.querySelectorAll(':scope > :not(#comments):not(ytd-playlist-panel-renderer#playlist)').forEach((el) => {
        if (el.style.display !== 'none') {
          el.style.display = 'none';
          hiddenEls.add(el);
        }
      });
    }

    const where = comments.parentElement === target ? 'OK ✓' : 'still not moved';
    if (lastStatus !== where) {
      status(where + ' (comments in scrollable right column)');
    }
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', scheduleApply);
  document.addEventListener('yt-page-data-updated', scheduleApply);
  window.addEventListener('popstate', scheduleApply);
  setInterval(scheduleApply, 3000);
  apply();
})();
