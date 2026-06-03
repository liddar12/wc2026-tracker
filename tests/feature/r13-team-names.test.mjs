import test from 'node:test';
import assert from 'node:assert/strict';
import { shortTeamName, tinyTeamName } from '../../app/lib/team-names.js';

test('R13: shortTeamName returns the original when short enough', () => {
  assert.equal(shortTeamName('USA'), 'USA');
  assert.equal(shortTeamName('Brazil'), 'Brazil');
});

test('R13: shortTeamName abbreviates names known to clip on iPhone 13', () => {
  assert.equal(shortTeamName('South Africa'), 'S. Africa');
  assert.equal(shortTeamName('Korea Republic'), 'S. Korea');
  assert.equal(shortTeamName('Bosnia and Herzegovina'), 'Bosnia');
});

test('R13: shortTeamName leaves names at the threshold alone', () => {
  // "Cape Verde" is exactly 10 chars — at the boundary, fits at default
  // card width so no abbreviation needed.
  assert.equal(shortTeamName('Cape Verde'), 'Cape Verde');
});

test('R13: shortTeamName falls back to original for unmapped long names', () => {
  assert.equal(shortTeamName('Imaginary Long Country'), 'Imaginary Long Country');
});

test('R13: tinyTeamName is more aggressive (cuts at 6 chars)', () => {
  assert.equal(tinyTeamName('USA'), 'USA');
  assert.equal(tinyTeamName('South Africa'), 'S. Africa');
});

test('R13: shortTeamName handles empty/null', () => {
  assert.equal(shortTeamName(''), '');
  assert.equal(shortTeamName(null), '');
  assert.equal(shortTeamName(undefined), '');
});
