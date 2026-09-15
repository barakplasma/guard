import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromClockInput, fromLocalDateTimeInput, toClockInput, toLocalDateTimeInput,
} from '../src/lib/localInput.js';

test('a date-time round-trips through the field value in local time', () => {
  const ms = new Date(2030, 8, 10, 8, 5).getTime();
  assert.equal(toLocalDateTimeInput(ms), '2030-09-10T08:05');
  assert.equal(fromLocalDateTimeInput('2030-09-10T08:05'), ms);
});

test('the value is 24-hour, so stepping back over noon is plain arithmetic', () => {
  // The whole reason the native field replaced the picker: a 12-hour field
  // counts hours inside their own half of the day, and three hours back from
  // 12:00 landed on 21:00.
  const noon = fromLocalDateTimeInput('2030-09-10T12:00');
  const three = fromLocalDateTimeInput('2030-09-10T09:00');
  assert.equal(noon - three, 3 * 3600 * 1000);
});

test('seconds are dropped so two identical-looking plans cannot differ', () => {
  const ms = new Date(2030, 8, 10, 8, 5, 37, 250).getTime();
  assert.equal(toLocalDateTimeInput(ms), '2030-09-10T08:05');
  assert.equal(new Date(fromLocalDateTimeInput('2030-09-10T08:05')).getSeconds(), 0);
});

test('a half-typed date-time is not a value', () => {
  for (const half of ['', '2030-09', '2030-09-10', '2030-09-10T08', 'nonsense', null, undefined]) {
    assert.equal(fromLocalDateTimeInput(half), null, String(half));
  }
});

test('a wall clock round-trips as minutes past midnight', () => {
  assert.equal(toClockInput(0), '00:00');
  assert.equal(toClockInput(8 * 60), '08:00');
  assert.equal(toClockInput(23 * 60 + 59), '23:59');
  assert.equal(fromClockInput('00:00'), 0);
  assert.equal(fromClockInput('08:00'), 480);
  assert.equal(fromClockInput('23:59'), 1439);
});

test('an empty or out-of-range clock is not a value', () => {
  for (const bad of ['', '8', '24:00', '25:00', 'x', null, undefined]) {
    assert.equal(fromClockInput(bad), null, String(bad));
  }
});

test('a missing instant renders as an empty field rather than 1970', () => {
  assert.equal(toLocalDateTimeInput(null), '');
  assert.equal(toLocalDateTimeInput(undefined), '');
  assert.equal(toClockInput(null), '');
});
