import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT_AGENT_PERSONA, parsePromptAnswer } from '../src/shared/illustration';

test('内置创作人设完整保留在插画提示词 Agent 中', () => {
  assert.ok(PROMPT_AGENT_PERSONA.startsWith('你是一名面向成年用户的创意写作助手'));
  assert.match(PROMPT_AGENT_PERSONA, /虚构情境与现实行为之间的区别/);
  assert.match(PROMPT_AGENT_PERSONA, /成人题材、浪漫关系、暧昧互动和情感描写/);
  assert.ok(PROMPT_AGENT_PERSONA.trimEnd().endsWith('提供合规的替代表达。'));
});

test('正常回答原样显示，不修改提示词', () => {
  const answer = parsePromptAnswer('她的银发配紫瞳很合适。你想让龙角是月光色，还是偏暖的象牙色？');
  assert.equal(answer.text, '她的银发配紫瞳很合适。你想让龙角是月光色，还是偏暖的象牙色？');
  assert.equal(answer.update, undefined);
});

test('回答末尾的 prompt 代码块被隐藏，并转成局部更新', () => {
  const answer = parsePromptAnswer('可以。我把光线换成黄昏，其余不变。\n\n```prompt\n{"positive":"masterpiece, silver hair, sunset light","negative":"low quality"}\n```');
  assert.equal(answer.text, '可以。我把光线换成黄昏，其余不变。');
  assert.deepEqual(answer.update, { positive: 'masterpiece, silver hair, sunset light', negative: 'low quality' });
});

test('只返回代码块时也能更新，正文为空', () => {
  const answer = parsePromptAnswer('```json\n{"pose":"坐在窗边读书"}\n```');
  assert.equal(answer.text, '');
  assert.deepEqual(answer.update, { pose: '坐在窗边读书' });
});

test('没有语言标记的代码块也能识别', () => {
  const answer = parsePromptAnswer('好的。\n\n```\n{"negative":"low quality, text"}\n```');
  assert.equal(answer.text, '好的。');
  assert.deepEqual(answer.update, { negative: 'low quality, text' });
});

test('兼容旧的整段 JSON 回复', () => {
  const answer = parsePromptAnswer('{"analysis":"把姿态改成侧躺。","positive":"masterpiece, lying on side"}');
  assert.equal(answer.text, '把姿态改成侧躺。');
  assert.deepEqual(answer.update, { positive: 'masterpiece, lying on side' });
});

test('只有 analysis 的旧回复仍作为回答显示', () => {
  const answer = parsePromptAnswer('{"analysis":"你希望她穿哪套衣服？"}');
  assert.equal(answer.text, '你希望她穿哪套衣服？');
  assert.equal(answer.update, undefined);
});

test('空内容、坏 JSON 和无关代码块都不会误改提示词', () => {
  assert.equal(parsePromptAnswer('').text, '');
  assert.equal(parsePromptAnswer('```prompt\n{broken}\n```').update, undefined);
  const code = parsePromptAnswer('这个标签写法是：\n\n```ts\nconst a = 1;\n```');
  assert.match(code.text, /const a = 1/);
  assert.equal(code.update, undefined);
});

test('非字符串或空字段不会被写进提示词', () => {
  const answer = parsePromptAnswer('```prompt\n{"positive":42,"negative":"   ","character":null,"pose":"坐在窗边"}\n```');
  assert.deepEqual(answer.update, { pose: '坐在窗边' });
});
