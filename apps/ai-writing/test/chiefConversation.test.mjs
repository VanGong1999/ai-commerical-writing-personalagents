import test from 'node:test';
import assert from 'node:assert/strict';
import { findChiefConversation } from '../src/features/agent-chat/chiefConversation.ts';

test('automatic assistant routing skips newer specialist and group conversations', () => {
 const specialist={id:'specialist',source:'assistant',kind:'dm',botId:'agent:dissect.guess'};
 const group={id:'group',source:'assistant',kind:'group',botId:'chief'};
 const external={id:'external',source:'feishu',kind:'dm',botId:'chief'};
 const chief={id:'chief-dm',source:'assistant',kind:'dm',botId:'chief'};
 assert.equal(findChiefConversation([specialist,group,external,chief]),chief);
 assert.equal(findChiefConversation([specialist,group,external]),undefined);
});
test('legacy unassigned direct assistant chats still resolve to the chief', () => {
 const legacy={id:'legacy',source:'assistant',kind:'dm',botId:null};
 assert.equal(findChiefConversation([legacy]),legacy);
});
