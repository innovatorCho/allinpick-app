import type { ReactNode } from "react";

/**
 * Renders the admin-editable user guide (site setting "userGuide"). A small,
 * fixed subset of Markdown so admins can structure it without HTML:
 * "## " starts a section heading, "- " a bullet, "1. " a numbered step,
 * "![설명](주소)" on its own line an image, and a blank line separates
 * paragraphs. Everything else is plain text, so nothing an admin types is
 * ever interpreted as markup.
 */
export function GuideText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={blocks.length} className="whitespace-pre-line">
        {paragraph.join("\n")}
      </p>
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{item}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} start={list.start} className="flex list-decimal flex-col gap-1.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="flex list-disc flex-col gap-1.5 pl-5">
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    // Site paths (/guide/…) or https URLs only, so a typo can't make a javascript: or data: src.
    const image = line.match(/^!\[([^\]]*)\]\(((?:\/(?!\/)|https:\/\/)\S+)\)$/);

    if (line === "") {
      flushParagraph();
      flushList();
    } else if (image) {
      flushParagraph();
      flushList();
      blocks.push(
        <figure key={blocks.length} className="flex flex-col items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin-supplied, possibly remote */}
          <img
            src={image[2]}
            alt={image[1]}
            loading="lazy"
            className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
          />
          {image[1] && <figcaption className="text-xs text-zinc-500">{image[1]}</figcaption>}
        </figure>
      );
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2 key={blocks.length} className="pt-4 text-base font-semibold text-zinc-900 first:pt-0 dark:text-zinc-100">
          {heading[1]}
        </h2>
      );
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered != null;
      if (list && list.ordered !== ordered) flushList();
      // Keeps "3." as 3 when an image splits a numbered list in two.
      list ??= { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return (
    <div className="flex flex-col gap-3 break-keep text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{blocks}</div>
  );
}
