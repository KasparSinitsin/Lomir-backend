const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { idNameToken } = require('../src/utils/eventNameToken');

// Evaluate the actual writer expressions without importing a controller or DB.
const source = (file) => fs.readFileSync(path.join(__dirname, '../src/controllers', file), 'utf8');
const declaration = (text, name) => {
  const match = text.match(new RegExp('const ' + name + ' = (`[^`]*`);'));
  assert.ok(match, `missing writer declaration: ${name}`);
  return match[0];
};

test('ownership transfer gives each owner their own id even with identical names', () => {
  const fullSource = source('teamMembersController.js');
  const text = fullSource.slice(fullSource.indexOf('const updateMemberRole ='));
  const code = ['prevToken', 'newToken', 'teamChatMessage']
    .map((name) => declaration(text, name)).join('\n');
  const message = vm.runInNewContext(code + '\nteamChatMessage', {
    userId: 42, memberId: '142', prevOwnerName: 'Alex Example', newOwnerName: 'Alex Example',
  });
  assert.equal(message, '👑 OWNERSHIP_TEAM: 42:Alex Example | 142:Alex Example');
});

test('team deletion keeps the team id separate from the owner id', () => {
  const message = vm.runInNewContext(
    declaration(source('teamController.js'), 'deleteMessage') + '\ndeleteMessage',
    { idNameToken, teamId: '900', teamName: 'Alex Example', userId: 42, ownerName: 'Alex Example' },
  );
  assert.equal(message, '🗑️ TEAM_DELETED: 900:Alex Example | 42:Alex Example');
});

test('account deletion writes an anonymous predecessor and a resolvable successor', () => {
  const expression = source('userDeletionController.js').match(/`👑 OWNERSHIP_TEAM:[^`]+`/);
  assert.ok(expression);
  const message = vm.runInNewContext(expression[0], {
    idNameToken, DELETED_USER_DISPLAY_NAME: 'Former Lomir User',
    successor: { userId: 142, name: 'Alex Example' },
  });
  assert.equal(message, '👑 OWNERSHIP_TEAM: Former Lomir User | 142:Alex Example');
});
