import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addEmployeesToPlan, addUniqueEmployees, duplicateEmployeeIds, nameKey,
} from '../src/lib/employees.js';

const list = (...names) => names.map((name, i) => ({
  id: `e${i + 1}`, name, start: null, end: null,
}));

test('the same name typed twice is added once', () => {
  const { employees, added, skipped } = addUniqueEmployees(list('דנה'), ['דנה']);
  assert.equal(employees.length, 1);
  assert.deepEqual(added, []);
  assert.deepEqual(skipped, ['דנה']);
});

test('surrounding and repeated whitespace is not a different person', () => {
  const { employees, skipped } = addUniqueEmployees(list('יוסי כהן'), ['  יוסי   כהן  ']);
  assert.equal(employees.length, 1);
  assert.deepEqual(skipped, ['יוסי   כהן']);
});

test('case differences in Latin names are the same person', () => {
  const { employees, skipped } = addUniqueEmployees(list('Dana'), ['dana', 'DANA']);
  assert.equal(employees.length, 1);
  assert.deepEqual(skipped, ['dana', 'DANA']);
});

test('a name repeated inside one paste is added once', () => {
  const { employees, added } = addUniqueEmployees([], ['אבי', 'רון', 'אבי']);
  assert.deepEqual(employees.map((e) => e.name), ['אבי', 'רון']);
  assert.deepEqual(added.map((e) => e.name), ['אבי', 'רון']);
});

test('distinct names all survive, with fresh ids', () => {
  const { employees } = addUniqueEmployees(list('אבי'), ['רון', 'תמר']);
  assert.deepEqual(employees.map((e) => e.id), ['e1', 'e2', 'e3']);
  assert.deepEqual(employees.map((e) => e.name), ['אבי', 'רון', 'תמר']);
});

test('ids skip the ones already taken rather than colliding', () => {
  const existing = [{ id: 'e2', name: 'אבי', start: null, end: null }];
  const { employees } = addUniqueEmployees(existing, ['רון', 'תמר']);
  assert.deepEqual(employees.map((e) => e.id), ['e2', 'e1', 'e3']);
});

test('blank lines are dropped, and never counted as duplicates of each other', () => {
  const { employees, skipped } = addUniqueEmployees([], ['', '   ', 'אבי']);
  assert.deepEqual(employees.map((e) => e.name), ['אבי']);
  assert.deepEqual(skipped, []);
});

test('added employees carry the whole-period default', () => {
  const { added } = addUniqueEmployees([], ['אבי']);
  assert.deepEqual(added, [{ id: 'e1', name: 'אבי', start: null, end: null }]);
});

test('does not mutate the list it was given', () => {
  const existing = list('אבי');
  const copy = structuredClone(existing);
  addUniqueEmployees(existing, ['רון']);
  assert.deepEqual(existing, copy);
});

test('a blank existing row does not block adding names', () => {
  const { employees, skipped } = addUniqueEmployees(list('', 'אבי'), ['רון']);
  assert.deepEqual(employees.map((e) => e.name), ['', 'אבי', 'רון']);
  assert.deepEqual(skipped, []);
});

test('both sides of a duplicate pair are flagged, blanks are not', () => {
  const ids = duplicateEmployeeIds(list('דנה', 'אבי', ' דנה', '', ''));
  assert.deepEqual([...ids].sort(), ['e1', 'e3']);
});

test('a list with no repeats flags nobody', () => {
  assert.equal(duplicateEmployeeIds(list('דנה', 'אבי')).size, 0);
});

test('the comparison key ignores case, padding and unicode form', () => {
  assert.equal(nameKey('  Dana  '), 'dana');
  // Same letter, decomposed vs precomposed - two keyboards, one name.
  assert.equal(nameKey('Jos\u00e9'), nameKey('Jose\u0301'));
  assert.equal(nameKey(null), '');
  assert.equal(nameKey(undefined), '');
});

test('a decomposed name is refused as a duplicate of its precomposed twin', () => {
  const { employees, skipped } = addUniqueEmployees(list('Jos\u00e9'), ['Jose\u0301']);
  assert.equal(employees.length, 1);
  assert.equal(skipped.length, 1);
});

test('consecutive employee additions compose against the latest plan', () => {
  const first = addEmployeesToPlan({ employees: [] }, ['Alice']);
  const second = addEmployeesToPlan(first.plan, ['Bob']);

  assert.deepEqual(second.plan.employees.map((employee) => employee.name), ['Alice', 'Bob']);
  assert.deepEqual(second.added.map((employee) => employee.name), ['Bob']);
});
