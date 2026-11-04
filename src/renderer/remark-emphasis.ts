// Transform only Markdown text and blockquotes, never raw HTML or code.
export function remarkEmphasis(){return (tree:any)=>{
  const visit=(node:any)=>{
    if(!Array.isArray(node.children))return;
    if(node.type==='blockquote'){
      const first=node.children[0]?.children?.[0];
      const match=first?.type==='text'&&first.value.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/);
      if(match){first.value=first.value.slice(match[0].length);node.data={hName:'aside',hProperties:{className:['message-callout',match[1].toLowerCase()]}};
        node.children.unshift({type:'paragraph',children:[{type:'strong',children:[{type:'text',value:({NOTE:'说明',TIP:'建议',WARNING:'提醒',IMPORTANT:'重点'} as Record<string,string>)[match[1]]}]}]});}
    }
    node.children=node.children.flatMap((child:any)=>{
      if(child.type!=='text'){visit(child);return [child];}
      const result:any[]=[];let last=0;const re=/==([^=\n]+)==/g;let match;
      while((match=re.exec(child.value))){if(match.index>last)result.push({type:'text',value:child.value.slice(last,match.index)});result.push({type:'emphasis',data:{hName:'mark'},children:[{type:'text',value:match[1]}]});last=re.lastIndex;}
      if(!last)return [child];if(last<child.value.length)result.push({type:'text',value:child.value.slice(last)});return result;
    });
  };visit(tree);
};}
export function copyProse(text:string){let fenced=false;return text.split('\n').map(line=>{if(/^\s*(```|~~~)/.test(line)){fenced=!fenced;return line;}return fenced?line:line.split(/(`+[^`]*`+)/g).map((part,i)=>i%2?part:part.replace(/==([^=\n]+)==/g,'$1').replace(/^(\s*>\s*)\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*/,'$1')).join('');}).join('\n');}
