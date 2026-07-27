// Small enhancements shared by every page: colours protocol lines in code
// samples, and marks the current section in the sidebar contents.

const TAGS = 'element|remove|signal|hello|action';
const TOKEN = new RegExp(
  `(^(?:${TAGS})(?= ))|("(?:[^"\\\\\\n]|\\\\.)*")(\\s*:)?|(-?\\b\\d+(?:\\.\\d+)?\\b|\\btrue\\b|\\bfalse\\b|\\bnull\\b)`,
  'gm',
);

function highlight(pre) {
  if (!new RegExp(`^(${TAGS}) \\{`, 'm').test(pre.textContent)) return;
  const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest('.c')) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const text = node.data;
    const frag = document.createDocumentFragment();
    let last = 0;
    // Text between tokens is JSON punctuation: let long lines wrap after commas.
    const plain = (s) => s.split(',').forEach((part, i) => {
      if (i) frag.append(',', document.createElement('wbr'));
      frag.append(part);
    });
    for (const m of text.matchAll(TOKEN)) {
      plain(text.slice(last, m.index));
      const span = (cls, s) => {
        const el = document.createElement('span');
        el.className = cls;
        el.textContent = s;
        return el;
      };
      if (m[1]) frag.append(span(`hl-tag t-${m[1]}`, m[1]));
      else if (m[2]) {
        frag.append(span(m[3] ? 'hl-key' : 'hl-str', m[2]));
        if (m[3]) frag.append(m[3]);
      } else frag.append(span('hl-num', m[4]));
      last = m.index + m[0].length;
    }
    plain(text.slice(last));
    node.replaceWith(frag);
  }
}

document.querySelectorAll('pre').forEach(highlight);

// Scroll spy for the sidebar contents.
const toc = document.querySelector('.toc');
if (toc && 'IntersectionObserver' in window) {
  const links = new Map();
  for (const a of toc.querySelectorAll('a[href^="#"]')) {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    if (target && !links.has(target)) links.set(target, a);
  }
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
    const first = [...links.keys()].find((t) => visible.has(t));
    if (!first) return;
    for (const a of links.values()) a.classList.toggle('active', a === links.get(first));
  }, { rootMargin: '-70px 0px -60% 0px' });
  for (const t of links.keys()) io.observe(t);
}
