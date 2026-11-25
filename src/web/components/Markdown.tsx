import { Fragment, useMemo } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/** Text written by an agent or the user, with its Markdown formatting. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn('grid grid-cols-1 gap-2.5 wrap-anywhere', className)}>
      <Blocks blocks={blocks} />
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, i) => <BlockView key={i} block={block} />);
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="whitespace-pre-wrap">
          <Inlines nodes={block.children} />
        </p>
      );
    case 'heading':
      // A message sits under the page's own headings, so its headings are only styled as such.
      return (
        <p className={cn('mt-1 font-semibold first:mt-0', block.level <= 2 && 'text-base')}>
          <Inlines nodes={block.children} />
        </p>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md border bg-background p-3 font-mono text-xs/5 wrap-normal">
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="grid grid-cols-1 gap-2 rounded-md bg-foreground/5 px-3 py-2 text-muted-foreground">
          <Blocks blocks={block.blocks} />
        </blockquote>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <div className="grid grid-cols-1 gap-1.5">
            <Blocks blocks={item} />
          </div>
        </li>
      ));
      const listClass = 'grid grid-cols-1 gap-1 pl-5 marker:text-muted-foreground';
      return block.start === null ? (
        <ul className={cn(listClass, 'list-disc')}>{items}</ul>
      ) : (
        <ol start={block.start} className={cn(listClass, 'list-decimal')}>
          {items}
        </ol>
      );
    }
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-xs/5 wrap-normal">
            <thead className="bg-foreground/5">
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} scope="col" className="px-2.5 py-1.5 font-semibold">
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t align-top">
                  {row.map((cell, j) => (
                    <td key={j} className="px-2.5 py-1.5">
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr />;
  }
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => <Fragment key={i}>{inlineView(node)}</Fragment>);
}

function inlineView(node: Inline) {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'code':
      return <code className="rounded-sm bg-foreground/10 px-1 py-0.5 font-mono text-xs">{node.text}</code>;
    case 'strong':
      return (
        <strong className="font-semibold">
          <Inlines nodes={node.children} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case 'del':
      return (
        <del>
          <Inlines nodes={node.children} />
        </del>
      );
    case 'link':
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="text-primary-ink underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Inlines nodes={node.children} />
        </a>
      );
  }
}
