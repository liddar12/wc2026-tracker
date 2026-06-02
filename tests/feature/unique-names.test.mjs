import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  allocateUnique,
  allocateUniqueHandle,
  allocateUniquePoolName,
} from '../../app/lib/unique-names.js';

function existsFnFrom(set) {
  return async (n) => set.has(n);
}

test('normalizeName trims, collapses whitespace, caps at 30', () => {
  assert.equal(normalizeName('  Jimmy   Liddar '), 'Jimmy Liddar');
  assert.equal(normalizeName('a'.repeat(40)).length, 30);
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
});

test('allocateUnique returns the original when free', async () => {
  const r = await allocateUnique('Jimmy', existsFnFrom(new Set()));
  assert.equal(r, 'Jimmy');
});

test('allocateUnique adds -2 on first collision', async () => {
  const r = await allocateUnique('Jimmy', existsFnFrom(new Set(['Jimmy'])));
  assert.equal(r, 'Jimmy-2');
});

test('allocateUnique walks suffixes until unique', async () => {
  const taken = new Set(['Jimmy', 'Jimmy-2', 'Jimmy-3']);
  const r = await allocateUnique('Jimmy', existsFnFrom(taken));
  assert.equal(r, 'Jimmy-4');
});

test('allocateUnique throws on empty base', async () => {
  await assert.rejects(() => allocateUnique('', existsFnFrom(new Set())));
});

test('handle and pool wrappers behave identically with checkExists', async () => {
  const taken = new Set(['Office Pool']);
  const h = await allocateUniqueHandle('Office Pool', { checkExists: existsFnFrom(taken) });
  const p = await allocateUniquePoolName('Office Pool', { checkExists: existsFnFrom(taken) });
  assert.equal(h, 'Office Pool-2');
  assert.equal(p, 'Office Pool-2');
});

test('respects maxAttempts ceiling', async () => {
  // Take Jimmy through Jimmy-50 → 51st attempt should fail
  const taken = new Set(['Jimmy']);
  for (let i = 2; i <= 50; i++) taken.add(`Jimmy-${i}`);
  await assert.rejects(() => allocateUnique('Jimmy', existsFnFrom(taken)));
});
