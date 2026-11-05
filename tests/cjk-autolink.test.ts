import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkCjkLink } from '../src/renderer/remark-cjk-link';

const render = (text: string) => renderToStaticMarkup(React.createElement(Markdown, { remarkPlugins: [remarkGfm, remarkCjkLink] }, text));

test('中文逗号后面的提示词不会被吞进链接', () => {
  const html = render('https://github.com/PC2005-cloud/dsh-pet，查阅这个桌宠项目，我想把桌宠换成蓝色大肥鱼。');
  assert.match(html, /<a href="https:\/\/github\.com\/PC2005-cloud\/dsh-pet">/);
  const link = html.match(/<a [^>]*>([\s\S]*?)<\/a>/)![1];
  assert.equal(link.includes('查阅'), false);
  assert.match(html, /<\/a>，查阅这个桌宠项目/);
});

test('全角句号、问号、括号都当分隔符', () => {
  for (const mark of ['。', '？', '）', '：', '、', '“']) {
    const html = render('https://example.com/a' + mark + '后面的话');
    const href = html.match(/<a href="([^"]*)"/)![1];
    assert.equal(href.includes('%EF%BC%8C'), false, mark + ' 不应留在链接里');
    assert.equal(decodeURIComponent(href).includes(mark), false, mark + ' 不应留在链接里');
    assert.match(html, new RegExp('</a>' + mark), mark + ' 之后的文字应在链接外');
  }
});

test('半角空格分隔的普通链接保持原样', () => {
  const html = render('看 https://github.com/PC2005-cloud/dsh-pet 这个项目');
  assert.match(html, /看 <a href="https:\/\/github\.com\/PC2005-cloud\/dsh-pet">https:\/\/github\.com\/PC2005-cloud\/dsh-pet<\/a> 这个项目/);
});

test('手写的 [文字](地址) 不被改写', () => {
  const html = render('[项目主页](https://example.com/a，b) 挺好');
  assert.match(html, /<a href="https:\/\/example\.com\/a%EF%BC%8Cb">项目主页<\/a>/);
});
