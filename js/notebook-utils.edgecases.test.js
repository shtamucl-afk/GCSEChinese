'use strict';

// ---------------------------------------------------------------------------
// Comprehensive edge-case + interaction-sequence suite for the My Notebook
// edit logic (pure functions in notebook-utils.js).
//
// Groups:
//   A  orderedNotebookPages   – ordering edge cases
//   B  applyPageOrder         – sortOrder renumbering edge cases
//   C  orderOfPages / nextPageIdFor – order derivation + id minting
//   D  parseWords / computeWordDiff – word-list parsing + diffing
//   E  computePageMerges      – rename/reorder detection
//   F  buildNotebookOps       – op emission + conflict resolution + limits
//   G  interaction sequences  – "user clicking unusually" multi-action sessions
//
// Pure (no DOM / Firestore). Run via `node --test`.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const U = require('./notebook-utils.js');

const STUDENT = 'sophie';

// Mirrors student.js notebookWordId() so simulated ids match production ids.
function wid(student, pageId, traditional) {
  const safeStudent = String(student).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\u4e00-\u9fff]/g, '');
  const safePage = String(pageId || '01');
  const safeWord = String(traditional).replace(/[^\u4e00-\u9fff]/g, '');
  return 'nb_' + safeStudent + '_' + safePage + '_' + safeWord;
}

function types(ops) { return ops.map(o => o.type); }
function has(ops, type) { return ops.some(o => o.type === type); }
function get(ops, type, pageId) { return ops.find(o => o.type === type && o.pageId === pageId); }
function wordIds(ops, type) { return ops.filter(o => o.type === type).map(o => o.wordId); }
function pageIds(ops, type) { return ops.filter(o => o.type === type).map(o => o.pageId).sort(); }

// ---------------------------------------------------------------------------
// A. orderedNotebookPages
// ---------------------------------------------------------------------------

test('A1 orderedNotebookPages: empty pages -> []', () => {
  assert.deepStrictEqual(U.orderedNotebookPages({}), []);
  assert.deepStrictEqual(U.orderedNotebookPages(undefined), []);
});

test('A2 orderedNotebookPages: all pages without sortOrder -> numeric pageId asc', () => {
  const pages = { '10': {}, '02': {}, '01': {} };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '02', '10']);
});

test('A3 orderedNotebookPages: all pages with sortOrder -> sortOrder asc', () => {
  const pages = { '01': { sortOrder: 0 }, '03': { sortOrder: 2 }, '02': { sortOrder: 1 } };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '02', '03']);
});

test('A4 orderedNotebookPages: duplicate sortOrder -> tie-break by pageId', () => {
  const pages = { '02': { sortOrder: 0 }, '01': { sortOrder: 0 } };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '02']);
});

test('A5 orderedNotebookPages: negative sortOrder sorts before positives', () => {
  const pages = { '01': { sortOrder: 1 }, '02': { sortOrder: -1 }, '03': { sortOrder: 0 } };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['02', '03', '01']);
});

test('A6 orderedNotebookPages: sortOrder as numeric string is coerced', () => {
  const pages = { '01': { sortOrder: '1' }, '02': { sortOrder: '0' } };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['02', '01']);
});

test('A7 orderedNotebookPages: sortOrder 0 is a valid key (not treated as absent)', () => {
  const pages = { '01': { sortOrder: 0 }, '02': { sortOrder: 5 }, '03': {} };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '03', '02']);
});

test('A8 orderedNotebookPages: non-numeric pageIds sort last (numeric fallback)', () => {
  const pages = { 'aa': {}, '01': {}, 'zz': {} };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', 'aa', 'zz']);
});

test('A9 orderedNotebookPages: non-finite sortOrder (NaN) falls back to numeric pageId', () => {
  const pages = { '01': { sortOrder: 'abc' }, '02': {} };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '02']);
});

test('A10 orderedNotebookPages: null/undefined page values do not crash', () => {
  const pages = { '01': null, '02': undefined, '03': {} };
  assert.deepStrictEqual(U.orderedNotebookPages(pages).map(p => p[0]), ['01', '02', '03']);
});

// ---------------------------------------------------------------------------
// B. applyPageOrder
// ---------------------------------------------------------------------------

test('B1 applyPageOrder: renumbers 0..n-1 along order', () => {
  const out = U.applyPageOrder({ '01': { title: 'Main' }, '02': { title: 'Food' }, '03': { title: 'Drink' } }, ['03', '01', '02']);
  assert.strictEqual(out['03'].sortOrder, 0);
  assert.strictEqual(out['01'].sortOrder, 1);
  assert.strictEqual(out['02'].sortOrder, 2);
});

test('B2 applyPageOrder: preserves other page fields (title, _context)', () => {
  const out = U.applyPageOrder({ '02': { title: 'Food', _context: 'ctx' } }, ['02']);
  assert.deepStrictEqual(out['02'], { title: 'Food', _context: 'ctx', sortOrder: 0 });
});

test('B3 applyPageOrder: pages not in order get sortOrder = order.length', () => {
  const out = U.applyPageOrder({ '01': {}, '02': {}, '03': {} }, ['02']);
  assert.strictEqual(out['02'].sortOrder, 0);
  assert.strictEqual(out['01'].sortOrder, 1);
  assert.strictEqual(out['03'].sortOrder, 1);
});

test('B4 applyPageOrder: empty order -> all pages sortOrder 0 (degenerate but safe)', () => {
  const out = U.applyPageOrder({ '01': {}, '02': {} }, []);
  assert.strictEqual(out['01'].sortOrder, 0);
  assert.strictEqual(out['02'].sortOrder, 0);
});

test('B5 applyPageOrder: duplicate ids in order -> first wins, renumber stays contiguous', () => {
  const out = U.applyPageOrder({ '01': {}, '02': {} }, ['02', '01', '02']);
  assert.strictEqual(out['01'].sortOrder, 1);
  assert.strictEqual(out['02'].sortOrder, 0);
});

test('B6 applyPageOrder: does not mutate input', () => {
  const pages = { '01': { title: 'Main' }, '02': { title: 'Food' } };
  const snap = JSON.stringify(pages);
  U.applyPageOrder(pages, ['02', '01']);
  assert.strictEqual(JSON.stringify(pages), snap);
});

test('B7 applyPageOrder: ids in order but not in pages create placeholder entries (caller must prune deletes)', () => {
  const out = U.applyPageOrder({ '01': {} }, ['99', '01']);
  assert.ok('99' in out);
  assert.strictEqual(out['99'].sortOrder, 0);
});

// ---------------------------------------------------------------------------
// C. orderOfPages + nextPageIdFor
// ---------------------------------------------------------------------------

test('C1 orderOfPages: derives current order (sortOrder, fallback numeric)', () => {
  assert.deepStrictEqual(U.orderOfPages({ '01': { sortOrder: 1 }, '02': {}, '03': { sortOrder: 0 } }), ['03', '01', '02']);
});

test('C2 nextPageIdFor: empty -> 01', () => {
  assert.strictEqual(U.nextPageIdFor({}), '01');
});

test('C3 nextPageIdFor: 01..05 -> 06', () => {
  const pages = { '01': {}, '02': {}, '03': {}, '04': {}, '05': {} };
  assert.strictEqual(U.nextPageIdFor(pages), '06');
});

test('C4 nextPageIdFor: ignores non-numeric ids', () => {
  assert.strictEqual(U.nextPageIdFor({ 'aa': {}, '01': {} }), '02');
});

test('C5 nextPageIdFor: two new pages never collide (batch-aware)', () => {
  const p1 = U.nextPageIdFor({ '01': {} });
  const p2 = U.nextPageIdFor({ '01': {}, [p1]: {} });
  assert.deepStrictEqual([p1, p2], ['02', '03']);
});

test('C6 nextPageIdFor: pads 09 -> 10', () => {
  const pages = {};
  for (let i = 1; i <= 9; i++) pages[String(i).padStart(2, '0')] = {};
  assert.strictEqual(U.nextPageIdFor(pages), '10');
});

// ---------------------------------------------------------------------------
// D. parseWords + computeWordDiff
// ---------------------------------------------------------------------------

test('D1 parseWords: splits on ascii comma, Chinese comma, 、, newline and trims', () => {
  assert.deepStrictEqual(U.parseWords('蘋果, 香蕉、學校\n米飯，飯'), ['蘋果', '香蕉', '學校', '米飯', '飯']);
});

test('D2 parseWords: drops non-CJK tokens and empties', () => {
  assert.deepStrictEqual(U.parseWords('apple, 蘋果, , foo'), ['蘋果']);
});

test('D3 parseWords: empty/null -> []', () => {
  assert.deepStrictEqual(U.parseWords(''), []);
  assert.deepStrictEqual(U.parseWords(null), []);
  assert.deepStrictEqual(U.parseWords('   ,   '), []);
});

test('D4 parseWords: keeps duplicates (dedup happens at the diff step)', () => {
  assert.deepStrictEqual(U.parseWords('蘋果, 蘋果'), ['蘋果', '蘋果']);
});

test('D10 parseWords: Simplified input is converted to Traditional (s2t)', () => {
  assert.deepStrictEqual(U.parseWords('工程师, 演员'), ['工程師', '演員']);
  assert.deepStrictEqual(U.parseWords('沟通交流'), ['溝通交流']);
  assert.deepStrictEqual(U.parseWords('解决问题'), ['解決問題']);
});

test('D11 parseWords: Traditional input is unchanged (idempotent)', () => {
  assert.deepStrictEqual(U.parseWords('工程師, 演員'), ['工程師', '演員']);
});

test('D12 parseWords: mixed script list converts only Simplified', () => {
  assert.deepStrictEqual(U.parseWords('工程师, 演員'), ['工程師', '演員']);
});

test('D13 parseWords: character corrections run AFTER s2t (臺→台, 喫→吃)', () => {
  // s2t turns 台→臺 and 吃→喫; the corrections mapping reverts them to modern forms.
  assert.deepStrictEqual(U.parseWords('台, 吃'), ['台', '吃']);
});

test('D14 toTraditional: phrase-aware (头发 → 頭髮, not 头發)', () => {
  assert.strictEqual(U.toTraditional('头发'), '頭髮');
  assert.strictEqual(U.toTraditional('后面'), '後面');
  assert.strictEqual(U.toTraditional('里面'), '裏面');
  assert.strictEqual(U.toTraditional('面条'), '麪條');
});

test('D15 CHARACTER_CORRECTIONS: third copy matches the .py mappings', () => {
  assert.deepStrictEqual(U.CHARACTER_CORRECTIONS, {
    '濃鬱': '濃郁',
    '喫': '吃',
    '臺': '台',
    '纔': '才'
  });
});

test('D5 computeWordDiff: added only', () => {
  assert.deepStrictEqual(U.computeWordDiff([], ['蘋果', '香蕉']), { added: ['蘋果', '香蕉'], removed: [] });
});

test('D6 computeWordDiff: removed only', () => {
  assert.deepStrictEqual(U.computeWordDiff(['蘋果', '香蕉'], ['香蕉']), { added: [], removed: ['蘋果'] });
});

test('D7 computeWordDiff: no change', () => {
  assert.deepStrictEqual(U.computeWordDiff(['蘋果'], ['蘋果']), { added: [], removed: [] });
});

test('D8 computeWordDiff: dedups added duplicates', () => {
  assert.deepStrictEqual(U.computeWordDiff([], ['蘋果', '蘋果']), { added: ['蘋果'], removed: [] });
});

test('D9 computeWordDiff: moving a word to another page -> removed here, added there', () => {
  assert.deepStrictEqual(U.computeWordDiff(['蘋果', '香蕉'], ['香蕉', '米飯']), { added: ['米飯'], removed: ['蘋果'] });
});

// ---------------------------------------------------------------------------
// E. computePageMerges
// ---------------------------------------------------------------------------

test('E1 rename detection (non-01, changed, non-empty)', () => {
  const m = U.computePageMerges({ '02': { title: 'Food' } }, { '02': { title: 'Drinks', sortOrder: 0 } });
  assert.deepStrictEqual(m.titleMerges, [{ pageId: '02', title: 'Drinks' }]);
});

test('E2 rename of page 01 is never emitted', () => {
  const m = U.computePageMerges({ '01': { title: 'Main page' } }, { '01': { title: 'Not Allowed', sortOrder: 0 } });
  assert.deepStrictEqual(m.titleMerges, []);
});

test('E3 rename to empty/whitespace is skipped', () => {
  assert.deepStrictEqual(U.computePageMerges({ '02': { title: 'Food' } }, { '02': { title: '   ' } }).titleMerges, []);
  assert.deepStrictEqual(U.computePageMerges({ '02': { title: 'Food' } }, { '02': { title: '' } }).titleMerges, []);
});

test('E4 rename to same title (whitespace-insensitive) is skipped', () => {
  assert.deepStrictEqual(U.computePageMerges({ '02': { title: 'Food' } }, { '02': { title: ' Food ' } }).titleMerges, []);
});

test('E5 multiple renames in one save', () => {
  const m = U.computePageMerges({ '02': { title: 'A' }, '03': { title: 'B' } }, { '02': { title: 'X' }, '03': { title: 'Y' } });
  assert.deepStrictEqual(m.titleMerges.map(t => t.pageId).sort(), ['02', '03']);
});

test('E6 sortOrder change detected (renumbered save)', () => {
  const m = U.computePageMerges({ '01': { sortOrder: 0 }, '02': { sortOrder: 1 } }, { '01': { sortOrder: 1 }, '02': { sortOrder: 0 } });
  assert.deepStrictEqual(m.sortOrderMerges.map(s => s.pageId).sort(), ['01', '02']);
});

test('E7 no order change -> no sortOrder merges', () => {
  const m = U.computePageMerges({ '01': { sortOrder: 0 }, '02': { sortOrder: 1 } }, { '01': { sortOrder: 0 }, '02': { sortOrder: 1 } });
  assert.deepStrictEqual(m.sortOrderMerges, []);
});

test('E8 rename + reorder of the same page -> both merges', () => {
  const m = U.computePageMerges({ '02': { title: 'A', sortOrder: 0 } }, { '02': { title: 'B', sortOrder: 1 } });
  assert.deepStrictEqual(m.titleMerges, [{ pageId: '02', title: 'B' }]);
  assert.deepStrictEqual(m.sortOrderMerges, [{ pageId: '02', sortOrder: 1 }]);
});

test('E9 new page (not in previous) -> no merges (pageSet handles it)', () => {
  const m = U.computePageMerges({ '01': {} }, { '01': {}, '02': { title: 'Food' } });
  assert.deepStrictEqual(m.titleMerges, []);
  assert.deepStrictEqual(m.sortOrderMerges, []);
});

test('E10 deleted page (not in next) -> no merges (pageDelete handles it)', () => {
  const m = U.computePageMerges({ '01': {}, '02': {} }, { '01': {} });
  assert.deepStrictEqual(m.titleMerges, []);
  assert.deepStrictEqual(m.sortOrderMerges, []);
});

test('E11 first-save of order (undefined -> number) emits sortOrder merges for all pages', () => {
  const m = U.computePageMerges({ '01': {}, '02': {} }, { '01': { sortOrder: 0 }, '02': { sortOrder: 1 } });
  assert.deepStrictEqual(m.sortOrderMerges.map(s => s.pageId).sort(), ['01', '02']);
});

// ---------------------------------------------------------------------------
// F. buildNotebookOps (extended)
// ---------------------------------------------------------------------------

test('F1 emits pageTitleMerge + sortOrderMerge ops', () => {
  const ops = U.buildNotebookOps(STUDENT, {}, [], {}, [], [],
    [{ pageId: '02', title: 'Drinks' }], [{ pageId: '02', sortOrder: 3 }]);
  assert.deepStrictEqual(ops, [
    { type: 'pageTitleMerge', pageId: '02', data: { title: 'Drinks' } },
    { type: 'sortOrderMerge', pageId: '02', data: { sortOrder: 3 } },
  ]);
});

test('F2 combined save emits all op types without duplicates', () => {
  const w = { [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果' } };
  const ops = U.buildNotebookOps(STUDENT, w, [wid(STUDENT, '03', '香蕉')],
    { '02': { title: 'Food' }, '03': { title: 'Old' } }, ['03'], ['02'],
    [{ pageId: '02', title: 'Drinks' }], [{ pageId: '02', sortOrder: 0 }]);
  const t = types(ops);
  assert.ok(t.includes('wordSet'));
  assert.ok(t.includes('wordDelete'));
  assert.ok(t.includes('pageSet'));
  assert.ok(t.includes('pageDelete'));
  assert.ok(t.includes('pageTitleMerge'));
  assert.ok(t.includes('sortOrderMerge'));
});

test('F3 wordDelete is suppressed when the word is re-added (wordSet wins)', () => {
  const w = { [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果' } };
  const ops = U.buildNotebookOps(STUDENT, w, [wid(STUDENT, '02', '蘋果')], {}, [], []);
  assert.deepStrictEqual(types(ops), ['wordSet']);
});

test('F4 pageDelete is suppressed when the page is re-created (pageSet wins)', () => {
  const ops = U.buildNotebookOps(STUDENT, {}, [], { '02': { title: 'Food' } }, ['02'], ['02']);
  assert.deepStrictEqual(types(ops), ['pageSet']);
});

test('F5 empty inputs -> no ops', () => {
  assert.deepStrictEqual(U.buildNotebookOps(STUDENT, {}, [], {}, [], [], [], []), []);
});

test('F6 op count stays well under Firestore batch limit (500) for large maps', () => {
  const words = {};
  for (let i = 0; i < 300; i++) words[wid(STUDENT, '01', '詞' + String(i).padStart(3, '0'))] = { traditional: '詞' };
  const removed = [];
  for (let i = 300; i < 320; i++) removed.push(wid(STUDENT, '01', '詞' + String(i).padStart(3, '0')));
  const pages = {};
  for (let i = 1; i <= 20; i++) pages[String(i).padStart(2, '0')] = { title: 'P' + i };
  const ops = U.buildNotebookOps(STUDENT, words, removed, pages, [], ['21', '22'],
    [{ pageId: '02', title: 'Renamed' }], [{ pageId: '03', sortOrder: 0 }]);
  assert.ok(ops.length < 500, 'ops=' + ops.length);
});

// ---------------------------------------------------------------------------
// G. Interaction sequences — "user clicking unusually"
// ---------------------------------------------------------------------------

// A pure model of the edit-page session, mirroring how Slice 4 executeChanges
// will orchestrate the pure helpers. Loaded pages snapshot is kept separate so
// rename/reorder detection compares against the pre-edit state.
function clonePages(pages) {
  const out = {};
  Object.keys(pages || {}).forEach(k => { out[k] = Object.assign({}, pages[k]); });
  return out;
}

function session(initialWords, initialPages) {
  const loadedPages = clonePages(initialPages); // deep clone: rename must not leak into the snapshot
  const state = {
    words: Object.assign({}, initialWords),
    pages: clonePages(initialPages),
    order: U.orderOfPages(initialPages),
    removedWordIds: [],
    deletedPageIds: [],
    newPageIds: [],
  };
  return {
    state,
    addWord(pageId, traditional) {
      const pid = pageId || '01';
      const id = wid(STUDENT, pid, traditional);
      const existing = state.words[id] || {};
      state.words[id] = { traditional, pageId: pid, simplified: existing.simplified || '', english: existing.english || '', pinyin: '', audio: existing.audio || {}, source: existing.source || 'notebook', status: 'pending', failCount: 0 };
    },
    removeWord(pageId, traditional) {
      const id = wid(STUDENT, pageId || '01', traditional);
      if (state.words[id]) { delete state.words[id]; state.removedWordIds.push(id); }
    },
    addPage(title) {
      const id = U.nextPageIdFor(state.pages);
      state.newPageIds.push(id);
      state.pages[id] = { title };
      state.order = [id].concat(state.order.filter(p => p !== id)); // new page at top
      return id;
    },
    deletePage(pid) {
      if (state.newPageIds.indexOf(pid) !== -1) {
        // Created this session -> discard entirely, never written.
        state.newPageIds = state.newPageIds.filter(p => p !== pid);
        Object.keys(state.words).forEach(w => { if ((state.words[w].pageId || '01') === pid) delete state.words[w]; });
      } else {
        state.deletedPageIds.push(pid);
        Object.keys(state.words).forEach(w => { if ((state.words[w].pageId || '01') === pid) { delete state.words[w]; state.removedWordIds.push(w); } });
      }
      delete state.pages[pid];
      state.order = state.order.filter(p => p !== pid);
    },
    renamePage(pid, title) { if (state.pages[pid]) state.pages[pid].title = title; },
    reorder(order) { state.order = order.slice(); },
    finalPages() { return U.applyPageOrder(state.pages, state.order); },
    ops() {
      const finalPages = U.applyPageOrder(state.pages, state.order);
      const merges = U.computePageMerges(loadedPages, finalPages);
      return U.buildNotebookOps(STUDENT, state.words, state.removedWordIds, finalPages, state.deletedPageIds, state.newPageIds, merges.titleMerges, merges.sortOrderMerges);
    },
  };
}

test('G1 add page -> delete it -> add it again: exactly one pageSet, no pageDelete', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  s.addPage('Food');
  s.deletePage('02');
  s.addPage('Food');
  const ops = s.ops();
  assert.strictEqual(ops.filter(o => o.type === 'pageSet').length, 1);
  assert.strictEqual(ops[0].pageId, '02');
  assert.strictEqual(ops[0].data.title, 'Food');
  assert.ok(!has(ops, 'pageDelete'));
  assert.ok(!has(ops, 'pageTitleMerge'));
});

test('G2 add page -> delete it -> add it with a different title: recreated fresh', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  s.addPage('Food');
  s.deletePage('02');
  s.addPage('Drinks');
  const sets = s.ops().filter(o => o.type === 'pageSet');
  assert.strictEqual(sets.length, 1);
  assert.strictEqual(sets[0].data.title, 'Drinks');
});

test('G3 deleting an existing page removes its words (wordDelete) and the page', () => {
  const words = {
    [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果', pageId: '02' },
    [wid(STUDENT, '01', '飯')]: { traditional: '飯', pageId: '01' },
  };
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'Food', sortOrder: 1 } };
  const s = session(words, pages);
  s.deletePage('02');
  const ops = s.ops();
  assert.ok(has(ops, 'pageDelete'));
  assert.ok(wordIds(ops, 'wordDelete').includes(wid(STUDENT, '02', '蘋果')));
  // untouched page's word is still rewritten (idempotent full-map design)
  assert.ok(wordIds(ops, 'wordSet').includes(wid(STUDENT, '01', '飯')));
});

test('G4 create a page with words, then delete it before saving: nothing is written', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  s.addPage('Food');
  s.addWord('02', '蘋果');
  s.deletePage('02');
  assert.deepStrictEqual(s.ops(), []);
});

test('G5 add word -> delete it -> re-add it: single wordSet wins, no wordDelete', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  s.addWord('01', '蘋果');
  s.removeWord('01', '蘋果');
  s.addWord('01', '蘋果');
  const ops = s.ops();
  assert.deepStrictEqual(wordIds(ops, 'wordSet'), [wid(STUDENT, '01', '蘋果')]);
  assert.ok(!has(ops, 'wordDelete'));
});

test('G6 rename + reorder + delete page + remove word all in one save: all reflected, minimal ops', () => {
  const words = {
    [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果', pageId: '02' },
    [wid(STUDENT, '03', '香蕉')]: { traditional: '香蕉', pageId: '03' },
  };
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'Food', sortOrder: 1 }, '03': { title: 'Drinks', sortOrder: 2 } };
  const s = session(words, pages);
  s.renamePage('02', 'Snacks');
  s.removeWord('03', '香蕉');
  s.deletePage('03');
  s.reorder(['02', '01']);
  const ops = s.ops();
  assert.deepStrictEqual(get(ops, 'pageTitleMerge', '02').data.title, 'Snacks');
  assert.ok(has(ops, 'pageDelete'));
  assert.ok(wordIds(ops, 'wordDelete').includes(wid(STUDENT, '03', '香蕉')));
  // reorder [02,01]: 02 -> 0, 01 -> 1 (both changed) => exactly 2 sortOrder merges
  assert.deepStrictEqual(ops.filter(o => o.type === 'sortOrderMerge').map(o => o.pageId).sort(), ['01', '02']);
});

test('G7 a pure reorder writes only the sortOrder merges that changed', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 }, '03': { title: 'B', sortOrder: 2 } };
  const s = session({}, pages);
  s.reorder(['03', '02', '01']);
  const ops = s.ops();
  const sm = ops.filter(o => o.type === 'sortOrderMerge');
  // 01: 0->2, 02: 1->1 (unchanged), 03: 2->0 => only 01 and 03 written
  assert.deepStrictEqual(sm.map(o => o.pageId).sort(), ['01', '03']);
  assert.strictEqual(ops.length, 2);
});

test('G8 new page is inserted at the TOP of the order (new-page-at-top)', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 } };
  const s = session({}, pages);
  s.addPage('Fresh');
  const ops = s.ops();
  const ps = ops.filter(o => o.type === 'pageSet')[0];
  assert.strictEqual(ps.pageId, '03');
  assert.strictEqual(ps.data.sortOrder, 0);
  // 01: 0->1, 02: 1->2
  assert.deepStrictEqual(ops.filter(o => o.type === 'sortOrderMerge').map(o => o.pageId).sort(), ['01', '02']);
});

test('G9 deleting every page except 01 leaves only 01 (order intact)', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 }, '03': { title: 'B', sortOrder: 2 } };
  const s = session({}, pages);
  s.deletePage('02');
  s.deletePage('03');
  const ops = s.ops();
  assert.ok(has(ops, 'pageDelete'));
  assert.ok(!has(ops, 'pageSet'));
  assert.strictEqual(s.finalPages()['01'].sortOrder, 0);
  assert.deepStrictEqual(U.orderOfPages(s.finalPages()), ['01']);
});

test('G10 two new pages in one save get distinct ids, newest on top', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  const a = s.addPage('Food');
  const b = s.addPage('Drinks');
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual(pageIds(s.ops(), 'pageSet'), ['02', '03']);
  assert.strictEqual(s.finalPages()[b].sortOrder, 0);
  assert.strictEqual(s.finalPages()[a].sortOrder, 1);
});

test('G11 renaming a page and adding words to it in one save: titleMerge + wordSet only', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'Food', sortOrder: 1 } };
  const s = session({}, pages);
  s.renamePage('02', 'Drinks');
  s.addWord('02', '蘋果');
  const ops = s.ops();
  assert.ok(has(ops, 'pageTitleMerge'));
  assert.ok(has(ops, 'wordSet'));
  assert.ok(!has(ops, 'sortOrderMerge'));
  assert.ok(!has(ops, 'pageSet'));
});

test('G12 moving a word from page A to page B in one save: delete on A, add on B', () => {
  const words = { [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果', pageId: '02' } };
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'Food', sortOrder: 1 } };
  const s = session(words, pages);
  s.removeWord('02', '蘋果');
  s.addWord('01', '蘋果');
  const ops = s.ops();
  assert.deepStrictEqual(wordIds(ops, 'wordDelete'), [wid(STUDENT, '02', '蘋果')]);
  assert.deepStrictEqual(wordIds(ops, 'wordSet'), [wid(STUDENT, '01', '蘋果')]);
});

test('G13 typing a duplicate word twice yields a single wordSet', () => {
  const s = session({}, { '01': { title: 'Main page', sortOrder: 0 } });
  s.addWord('01', '蘋果');
  s.addWord('01', '蘋果');
  assert.strictEqual(wordIds(s.ops(), 'wordSet').length, 1);
});

test('G14 deleting a page that is also in the reorder list: page gone, no orphan ops', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 }, '03': { title: 'B', sortOrder: 2 } };
  const s = session({}, pages);
  s.reorder(['03', '02', '01']);
  s.deletePage('02');
  const ops = s.ops();
  assert.ok(has(ops, 'pageDelete'));
  assert.ok(!has(ops, 'pageSet'));
  assert.deepStrictEqual(U.orderOfPages(s.finalPages()), ['03', '01']);
});

test('G15 a second save with no edits rewrites the word map (idempotent) but no page/order ops', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 } };
  const s1 = session({}, pages);
  s1.addWord('01', '蘋果');
  const s2 = session(s1.state.words, s1.finalPages());
  const ops = s2.ops();
  assert.deepStrictEqual(types(ops), ['wordSet']);
  assert.ok(!has(ops, 'pageSet') && !has(ops, 'pageDelete') && !has(ops, 'sortOrderMerge') && !has(ops, 'pageTitleMerge'));
});

test('G16 renaming the Main page (01) is blocked: no titleMerge ever', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 } };
  const s = session({}, pages);
  s.renamePage('01', 'Hacked');
  assert.ok(!has(s.ops(), 'pageTitleMerge'));
});

test('G17 empty order list (degenerate UI state): no crash, order collapses safely', () => {
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'A', sortOrder: 1 } };
  const s = session({}, pages);
  s.reorder([]);
  const ops = s.ops();
  assert.strictEqual(s.finalPages()['02'].sortOrder, 0);
  assert.ok(has(ops, 'sortOrderMerge'));
});

test('G18 reorder + rename + add page + delete page in a single chaotic save is consistent', () => {
  const words = { [wid(STUDENT, '02', '蘋果')]: { traditional: '蘋果', pageId: '02' } };
  const pages = { '01': { title: 'Main page', sortOrder: 0 }, '02': { title: 'Food', sortOrder: 1 }, '03': { title: 'Drinks', sortOrder: 2 } };
  const s = session(words, pages);
  const np = s.addPage('New');            // 04 at top
  s.renamePage('03', 'Beverages');        // rename
  s.deletePage('02');                     // delete (removes 蘋果)
  s.addWord('01', '米飯');                 // add word to 01
  s.reorder([np, '03', '01']);            // reorder
  const ops = s.ops();
  const fp = s.finalPages();
  // page 04 (new) at top, then 03, then 01
  assert.deepStrictEqual(U.orderOfPages(fp), [np, '03', '01']);
  assert.strictEqual(fp[np].sortOrder, 0);
  // delete of 02 -> pageDelete + wordDelete for 蘋果
  assert.ok(has(ops, 'pageDelete'));
  assert.ok(wordIds(ops, 'wordDelete').includes(wid(STUDENT, '02', '蘋果')));
  // rename of 03
  assert.deepStrictEqual(get(ops, 'pageTitleMerge', '03').data.title, 'Beverages');
  // new page 04 written as pageSet with sortOrder 0
  assert.strictEqual(ops.filter(o => o.type === 'pageSet' && o.pageId === np)[0].data.sortOrder, 0);
  // new word 米飯 on 01 written
  assert.ok(wordIds(ops, 'wordSet').includes(wid(STUDENT, '01', '米飯')));
});

test('G19 rename must not leak into the before-snapshot: clonePageMap yields independent page objects', () => {
  // Regression: executeChanges built pages/loadedPages as SHALLOW copies of
  // notebookPages, so renaming `pages[pid].title` also mutated the snapshot
  // passed to computePageMerges -> the rename was silently dropped and never
  // reached Firestore (UI said "renamed", DB kept the old title).
  const notebookPages = { '01': { title: 'Main page', sortOrder: 0 }, '03': { title: 'another', sortOrder: 2 } };
  const pages = U.clonePageMap(notebookPages);
  const loadedPages = U.clonePageMap(notebookPages);
  pages['03'] = pages['03'] || {};
  pages['03'].title = 'ChangeName';
  // The before-snapshot must be untouched by the rename.
  assert.strictEqual(loadedPages['03'].title, 'another');
  const finalPages = U.applyPageOrder(pages, ['01', '03']);
  const m = U.computePageMerges(loadedPages, finalPages);
  // ...so the rename is detected and persisted.
  assert.deepStrictEqual(m.titleMerges, [{ pageId: '03', title: 'ChangeName' }]);
});
