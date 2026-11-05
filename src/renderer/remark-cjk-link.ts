// GFM 自动链接只在半角空白和半角标点处停下，中文全角标点会被吞进 URL，
// 于是「https://…，后面一整段话」整条变成一个链接。这里把标点之后的文字切回来。
const STOP = /[，。；：！？、（）【】《》「」『』〈〉“”‘’…—～·\u3000]/;

export function remarkCjkLink() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.flatMap((child: any) => {
        walk(child);
        if (child.type !== 'link' || child.title) return [child];
        const text = (child.children ?? []).map((c: any) => c.value ?? '').join('');
        let base = child.url, idx = base.search(STOP);
        if (idx < 0) {
          // 有的渲染管线会把中文写成 %E4%BD%A0 这种，先解一次再找。
          try { const decoded = decodeURIComponent(child.url), j = decoded.search(STOP); if (j > 0) { base = decoded; idx = j; } } catch { /* 不是合法转义就保持原样 */ }
        }
        if (idx <= 0) return [child];
        const head = base.slice(0, idx), tail = base.slice(idx);
        // 只切自动链接（链接文字就是整段地址）；手写的 [文字](地址) 不动。
        const cut = text.indexOf(tail);
        if (cut < 0) return [child];
        child.url = head;
        child.children = [{ type: 'text', value: text.slice(0, cut) }];
        return [child, { type: 'text', value: tail }];
      });
    };
    walk(tree);
  };
}
