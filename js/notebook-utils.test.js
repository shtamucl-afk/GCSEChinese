'use strict';

const test = require('node:test');
const assert = require('node:assert');
const NotebookUtils = require('./notebook-utils.js');

test('buildNotebookOps emits wordSet for every final word (idempotent full-map semantics)', () => {
  const words = { nb_a_01_x: { traditional: 'x' }, nb_a_02_y: { traditional: 'y' } };
  const ops = NotebookUtils.buildNotebookOps('a', words, [], {}, [], []);
  assert.ok(ops.some(o => o.type === 'wordSet' && o.wordId === 'nb_a_01_x' && o.data.traditional === 'x'));
  assert.ok(ops.some(o => o.type === 'wordSet' && o.wordId === 'nb_a_02_y'));
});

test('buildNotebookOps emits wordDelete for removed ids and nothing else', () => {
  const ops = NotebookUtils.buildNotebookOps('a', {}, ['nb_a_02_y'], {}, [], []);
  assert.deepStrictEqual(ops, [{ type: 'wordDelete', wordId: 'nb_a_02_y' }]);
});

test('buildNotebookOps emits pageSet for new pages and pageDelete for deleted pages', () => {
  const ops = NotebookUtils.buildNotebookOps(
    'a', {}, [],
    { '04': { title: 'Food' } }, ['03'], ['04']);
  assert.ok(ops.some(o => o.type === 'pageSet' && o.pageId === '04' && o.data.title === 'Food'));
  assert.ok(ops.some(o => o.type === 'pageDelete' && o.pageId === '03'));
});

test('buildNotebookOps with no changes emits no ops', () => {
  assert.deepStrictEqual(NotebookUtils.buildNotebookOps('a', {}, [], {}, [], []), []);
});

test('orderedNotebookPages sorts by sortOrder asc, falling back to numeric pageId', () => {
  const pages = { '02': { title: 'B', sortOrder: 1 }, '01': { title: 'Main page' }, '03': { title: 'C', sortOrder: 0 } };
  const ordered = NotebookUtils.orderedNotebookPages(pages).map(([pid]) => pid);
  assert.deepStrictEqual(ordered, ['03', '01', '02']);
});

test('orderedNotebookPages falls back to numeric pageId when no sortOrder present', () => {
  const pages = { '10': {}, '02': {}, '01': {} };
  const ordered = NotebookUtils.orderedNotebookPages(pages).map(([pid]) => pid);
  assert.deepStrictEqual(ordered, ['01', '02', '10']);
});

test('orderedNotebookPages ties break by pageId (ascending)', () => {
  const pages = { '02': { sortOrder: 0 }, '01': { sortOrder: 0 } };
  const ordered = NotebookUtils.orderedNotebookPages(pages).map(([pid]) => pid);
  assert.deepStrictEqual(ordered, ['01', '02']);
});

test('orderedNotebookPages puts non-numeric pageIds last (numeric fallback 999)', () => {
  const pages = { 'x': {}, '01': {}, '02': { sortOrder: 0 } };
  const ordered = NotebookUtils.orderedNotebookPages(pages).map(([pid]) => pid);
  assert.deepStrictEqual(ordered, ['02', '01', 'x']);
});
