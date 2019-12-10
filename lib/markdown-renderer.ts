import { fromString } from "html-to-text";
import marked from "marked";

// @types/html-to-text v1.4.31 does not handle the `format` attribute; To work
// around that, we simply implement a class that has that (we want a different
// rendering of headings than html-to-text provides by default).

class MyOptions implements HtmlToTextOptions {
    public hideLinkHrefIfSameAsText = true;
    public uppercaseHeadings = false;
    public wordwrap = 76;

    public format = {
        heading(elem: any, fn: any, options: any): string {
            const heading: string = fn(elem.children, options);
            const underline = heading.substr(heading.lastIndexOf("\n") + 1)
                .replace(/./g, "=");
            return `${heading}\n${underline}\n\n`;
        },
        blockquote(elem: any, fn: any, options: any): string {
            const indentOptions = Object.assign({}, options);
            // decrease word wrap, but only to a minimum of 20 columns/line
            indentOptions.wordwrap = Math.max(20, options.wordwrap - 2);

            const block: string = fn(elem.children, indentOptions);
            return block.replace(/^>/mg, ">>") // add to quote
                .replace(/^(?!>|$)/mg, "> ")   // new quote
                .replace(/(^|\n)(\n)(?!$)/g, "$1>$2"); // quote empty lines
        },
    };

    public constructor(columns?: number) {
        if (columns !== undefined) {
            this.wordwrap = columns;
        }
    }
}

export function md2text(markdown: string, columns?: number): string {
    return fromString(marked(markdown), new MyOptions(columns));
}
