'use strict';
// 链接识别逻辑单测（与 index.html 中实现保持一致）
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`，。；：！？、（）【】《》「」『』]+/gi;

function cleanUrl(u) { return u.replace(/[.,;:!?)\]}>"''”』」】》]+$/, ''); }
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function linkify(t) {
  return t.replace(URL_RE, (m) => {
    const h = cleanUrl(/^www\./i.test(m) ? 'https://' + m : m).replace(/["']/g, '');
    return '<a href="' + h + '" target="_blank" rel="noopener noreferrer">' + h + '</a>';
  });
}
function isSingleUrl(text) {
  const t = text.trim();
  const m = t.match(URL_RE);
  return !!m && m.length === 1 && cleanUrl(m[0]) === t;
}

let fail = 0;
const tests = [
  ['https://github.com/Qiuzizhao/Pasteboard', true],
  ['https://example.com.', false],            // 末尾带句号 → 走 linkify 路径（仍可点）
  ['www.example.com', true],
  ['http://127.0.0.1:8123', true],
  ['看这个 https://a.com/x?y=1&z=2 不错', false],
  ['普通文字', false],
  ['https://a.com', true],
  ['https://a.com 和 https://b.com', false],
];
for (const [t, exp] of tests) {
  const got = isSingleUrl(t);
  if (got !== exp) { console.log('FAIL isSingleUrl(' + JSON.stringify(t) + ') = ' + got + ' (expect ' + exp + ')'); fail++; }
  else console.log('OK   isSingleUrl(' + JSON.stringify(t) + ')');
}

console.log('--- linkify 输出 ---');
const l1 = linkify(escapeHtml('看这个 https://a.com/x?y=1&z=2，然后 www.b.com 也行'));
console.log(l1);
const l2 = linkify(escapeHtml('恶意 <script>alert(1)</script> https://safe.com'));
console.log(l2);
if (l1.indexOf('<a href="https://a.com/x?y=1&amp;z=2"') === -1) { console.log('FAIL link1'); fail++; }
if (l1.indexOf('>https://a.com/x?y=1&amp;z=2</a>') === -1) { console.log('FAIL link1 文本'); fail++; }
if (l1.indexOf('https://www.b.com') === -1) { console.log('FAIL link2'); fail++; }
if (l2.indexOf('&lt;script&gt;') === -1) { console.log('FAIL xss 转义'); fail++; }
if (l2.indexOf('<a href="https://safe.com"') === -1) { console.log('FAIL link3'); fail++; }
console.log(fail === 0 ? '=== 全部通过 ===' : '=== 有 ' + fail + ' 个失败 ===');
process.exit(fail === 0 ? 0 : 1);
