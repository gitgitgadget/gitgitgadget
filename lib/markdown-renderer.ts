import { fromString, HtmlToTextOptions } from "html-to-text";
import marked from "marked";

// Provide our own renderings of headings and block quotes.

export function md2text(markdown: string, columns = 76): string {
    const formatOptions: HtmlToTextOptions = {
        hideLinkHrefIfSameAsText: true,
        uppercaseHeadings: false,
        wordwrap: columns,

        format: {
            heading: (elem: { children: any[] }, fn, options) => {
                const heading = fn(elem.children, options);
                const underline = heading.substr(heading.lastIndexOf("\n") + 1)
                    .replace(/./g, "=");
                return `${heading}\n${underline}\n\n`;
            },
            blockquote: (elem: { children: any[] }, fn, options) => {
                const indentOptions = Object.assign({ wordwrap: 76 }, options);
                // decrease word wrap, but only to a minimum of 20 columns/line
                indentOptions.wordwrap = Math.max(20, indentOptions.wordwrap-2);

                const block = fn(elem.children, indentOptions);
                return block.replace(/^>/mg, ">>") // add to quote
                    .replace(/^(?!>|$)/mg, "> ")   // new quote
                    .replace(/(^|\n)(\n)(?!$)/g, "$1>$2"); // quote empty lines
            },
        },
    };

    return fromString(marked(markdown), formatOptions);
}
