/**
 * Pure helpers for My Notebook (no DOM / Firestore access) — unit-testable in Node.
 *
 * Browser usage:  loaded via <script src="js/notebook-utils.js"> -> window.NotebookUtils
 * Node usage:     require('./notebook-utils.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.NotebookUtils = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Build the atomic write operations for a notebook save.
   *
   * @param {string}   student         student name
   * @param {Object}   finalWords      final words map { wordId: entry }
   * @param {string[]} removedWordIds  word ids deleted in this save
   * @param {Object}   finalPages      final pages map { pageId: page }
   * @param {string[]} deletedPageIds  page ids deleted in this save
   * @param {string[]} newPageIds      page ids created in this save
   * @returns {Array<Object>} ops, each:
   *   {type:'wordSet',   wordId, data}
   *   {type:'wordDelete',wordId}
   *   {type:'pageSet',   pageId, data}
   *   {type:'pageDelete',pageId}
   */
  function buildNotebookOps(student, finalWords, removedWordIds,
                            finalPages, deletedPageIds, newPageIds,
                            pageTitleMerges, sortOrderMerges) {
    const ops = [];
    Object.keys(finalWords || {}).forEach(function (wid) {
      ops.push({ type: 'wordSet', wordId: wid, data: finalWords[wid] });
    });
    (removedWordIds || []).forEach(function (wid) {
      // Conflict resolution: if the word is re-added this save, wordSet wins.
      if (!(finalWords || {}).hasOwnProperty(wid)) {
        ops.push({ type: 'wordDelete', wordId: wid });
      }
    });
    (newPageIds || []).forEach(function (pid) {
      ops.push({ type: 'pageSet', pageId: pid, data: (finalPages || {})[pid] });
    });
    (deletedPageIds || []).forEach(function (pid) {
      // Conflict resolution: if the page is re-created this save, pageSet wins.
      if (!(newPageIds || []).includes(pid)) {
        ops.push({ type: 'pageDelete', pageId: pid });
      }
    });
    (pageTitleMerges || []).forEach(function (m) {
      ops.push({ type: 'pageTitleMerge', pageId: m.pageId, data: { title: m.title } });
    });
    (sortOrderMerges || []).forEach(function (m) {
      ops.push({ type: 'sortOrderMerge', pageId: m.pageId, data: { sortOrder: m.sortOrder } });
    });
    return ops;
  }

  /**
   * Order notebook pages by sortOrder (ascending); pages without sortOrder
   * fall back to numeric pageId. Non-numeric pageIds sort last. Tie-break by id.
   *
   * @param {Object} pages  { pageId: page }
   * @returns {Array<[pageId, page]>} ordered pairs
   */
  function orderedNotebookPages(pages) {
    return Object.entries(pages || {}).sort(function (a, b) {
      function key(pair) {
        const page = pair[1];
        if (page && page.sortOrder != null) {
          const n = Number(page.sortOrder);
          if (Number.isFinite(n)) return n;
        }
        const n = parseInt(pair[0], 10);
        return Number.isNaN(n) ? 999 : n;
      }
      const ka = key(a);
      const kb = key(b);
      if (ka !== kb) return ka - kb;
      return String(a[0]).localeCompare(String(b[0]));
    });
  }

  /**
   * Renumber sortOrder along `order` (0..n-1). Pages not listed in `order`
   * get sortOrder = order.length. Duplicate ids in `order` are ignored
   * (first occurrence wins) so renumbering stays contiguous. Pure.
   */
  function applyPageOrder(pages, order) {
    const out = {};
    const seen = {};
    (order || []).forEach(function (pid, i) {
      if (seen[pid]) return;
      seen[pid] = true;
      out[pid] = Object.assign({}, pages[pid] || {}, { sortOrder: i });
    });
    Object.keys(pages || {}).forEach(function (pid) {
      if (!(pid in out)) {
        out[pid] = Object.assign({}, pages[pid], { sortOrder: (order || []).length });
      }
    });
    return out;
  }

  /** Derive the current display order of pages as a list of page ids. Pure. */
  function orderOfPages(pages) {
    return orderedNotebookPages(pages).map(function (pair) { return pair[0]; });
  }

  /**
   * Next numeric page id (zero-padded). Reads the WORKING map so two new
   * pages in one save never collide. Pure.
   */
  function nextPageIdFor(pagesMap) {
    const nums = [];
    Object.keys(pagesMap || {}).forEach(function (key) {
      const n = parseInt(key, 10);
      if (!Number.isNaN(n)) nums.push(n);
    });
    return String(Math.max(0, ...nums) + 1).padStart(2, '0');
  }

  /**
   * Character corrections: archaic Traditional variants → modern standard
   * forms. THIRD copy of the mapping — must stay in sync with
   * Chinese-Learning-App/Modules/character_corrections.py and
   * workflows-tools/vocab_transfer/character_corrections.py.
   * See library/textbook/wiki/character-correction.md.
   */
  var CHARACTER_CORRECTIONS = {
    '濃鬱': '濃郁',
    '喫': '吃',
    '臺': '台',
    '纔': '才'
  };

  /** Resolve the OpenCC library (browser global or Node require). */
  function resolveOpenCC() {
    if (typeof OpenCC !== 'undefined' && OpenCC && OpenCC.Converter) {
      return OpenCC;                                     // browser <script> global
    }
    try {
      // Node (unit tests / build tooling)
      // eslint-disable-next-line global-require
      var cc = require('opencc-js');
      if (cc && cc.Converter) return cc;
    } catch (e) { /* not in node */ }
    return null;
  }

  var _s2t = null; // lazy singleton: per-word Simplified→Traditional converter

  /** Get the s2t converter, using the base 's2t' config so output matches the
   *  pipeline's Python OpenCC('s2t') exactly. */
  function s2tConverter() {
    if (!_s2t) {
      var cc = resolveOpenCC();
      if (!cc) return null;
      _s2t = cc.Converter({ from: 'cn', to: 't' });
    }
    return _s2t;
  }

  /** Simplified → Traditional (per word). Idempotent on already-Traditional. */
  function toTraditional(word) {
    if (!word) return word;
    var conv = s2tConverter();
    if (!conv) return word; // fail-safe: no converter → pass through unchanged
    return conv(word);
  }

  /** Replace archaic Traditional variants with modern standard forms. */
  function applyCharacterCorrections(text) {
    if (!text) return text;
    return Object.keys(CHARACTER_CORRECTIONS).reduce(function (t, wrong) {
      return t.split(wrong).join(CHARACTER_CORRECTIONS[wrong]);
    }, text);
  }

  /**
   * Parse a comma/newline-separated word list (Traditional Chinese only),
   * converting each word Simplified→Traditional then applying character
   * corrections, so word IDs and stored `traditional` are script-consistent.
   * Pure (OpenCC is deterministic).
   */
  function parseWords(text) {
    return String(text || '').split(/[,，、\n]/).map(function (w) { return w.trim(); })
      .filter(function (w) { return w && /[\u4e00-\u9fff]/.test(w); })
      .map(function (w) {
        return applyCharacterCorrections(toTraditional(w));
      });
  }

  /**
   * Word-level diff between a page's current words and its desired words.
   * `added` is deduped; `removed` are current words not in desired. Pure.
   */
  function computeWordDiff(currentWords, desired) {
    const current = currentWords || [];
    const desiredList = desired || [];
    const removed = current.filter(function (v) { return desiredList.indexOf(v) === -1; });
    const added = [];
    desiredList.forEach(function (v) {
      if (current.indexOf(v) === -1 && added.indexOf(v) === -1) added.push(v);
    });
    return { added: added, removed: removed };
  }

  /**
   * Deep-clone a page map { pageId: page } into brand-new page objects.
   * Callers that later mutate a working copy (e.g. rename) MUST base their
   * before/after snapshots on independent clones — a shallow top-level copy
   * shares page objects, so renaming `pages[pid].title` would also mutate the
   * 'before' snapshot and hide the change from computePageMerges. Pure.
   */
  function clonePageMap(pages) {
    const out = {};
    Object.keys(pages || {}).forEach(function (pid) {
      out[pid] = Object.assign({}, pages[pid] || {});
    });
    return out;
  }

  /**
   * Compute page-level merge ops between the previous (loaded) pages and the
   * next (edited) pages: renames (non-01, non-empty, changed) and sortOrder
   * changes. New pages (not in previous) are pageSet ops; deleted pages are
   * pageDelete ops — neither is a merge. Pure.
   */
  function computePageMerges(previousPages, nextPages) {
    const titleMerges = [];
    const sortOrderMerges = [];
    Object.keys(nextPages || {}).forEach(function (pid) {
      const prev = (previousPages || {})[pid];
      if (!prev) return; // new page -> pageSet
      const next = nextPages[pid] || {};
      const nextTitle = next.title != null ? String(next.title).trim() : '';
      const prevTitle = prev.title != null ? String(prev.title).trim() : '';
      if (pid !== '01' && nextTitle !== '' && nextTitle !== prevTitle) {
        titleMerges.push({ pageId: pid, title: nextTitle });
      }
      if (next.sortOrder != null && next.sortOrder !== prev.sortOrder) {
        sortOrderMerges.push({ pageId: pid, sortOrder: next.sortOrder });
      }
    });
    return { titleMerges: titleMerges, sortOrderMerges: sortOrderMerges };
  }

  return {
    buildNotebookOps: buildNotebookOps,
    orderedNotebookPages: orderedNotebookPages,
    applyPageOrder: applyPageOrder,
    orderOfPages: orderOfPages,
    nextPageIdFor: nextPageIdFor,
    parseWords: parseWords,
    computeWordDiff: computeWordDiff,
    computePageMerges: computePageMerges,
    clonePageMap: clonePageMap,
    toTraditional: toTraditional,
    applyCharacterCorrections: applyCharacterCorrections,
    CHARACTER_CORRECTIONS: CHARACTER_CORRECTIONS
  };
}));
