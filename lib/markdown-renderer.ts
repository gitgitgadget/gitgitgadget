import { htmlToText, HtmlToTextOptions } from "html-to-text";
import { marked } from "marked";

// Provide our own renderings of headings and block quotes.

export function md2text(markdown: string, columns = 76): string {

    let quoteDepth = 0;
    const formatOptions: HtmlToTextOptions = {
        wordwrap: columns,
        formatters: {
            headerFormatter: (elem, walk, builder, options) => {
                builder.openBlock({
                    leadingLineBreaks: options.leadingLineBreaks || 2});
                walk(elem.children, builder);
                builder.closeBlock({
                    trailingLineBreaks: options.trailingLineBreaks || 2,
                    blockTransform: str => {
                        const underline = str.substring(str.lastIndexOf("\n") + 1)
                            .replace(/./g, "=");
                        return `${str}\n${underline}`;
                    }});
            },
            blockFormatter: (elem, walk, builder, options) => {
                builder.openBlock({
                    leadingLineBreaks: options.leadingLineBreaks || 2,
                    reservedLineLength: quoteDepth? 1 : 2});
                quoteDepth++;
                walk(elem.children, builder);
                quoteDepth--;
                builder.closeBlock({ trailingLineBreaks:
                    options.trailingLineBreaks || 2,
                    blockTransform: str => { return str
                        .replace(/^>/mg, ">>") // add to quote
                        .replace(/^(?!>|$)/mg, "> ")   // new quote
                        .replace(/(^|\n)(\n)(?!$)/g, "$1>$2"); // quote empty
                    }});
            },
            checkBoxFormatter: (elem, _walk, builder) => {
                const attribs = elem.attribs as { checked?: string };
                builder.addInline(attribs.checked === undefined ? "[ ]" : "[x]");
            },
        },
        selectors: [
            {
                selector: "a",
                options: {
                    hideLinkHrefIfSameAsText: true,
                },
            },
            {
                selector: "h1",
                options: {
                    uppercase: false
                },
                format: "headerFormatter",
            },
            {
                selector: "h2",
                options: {
                    uppercase: false
                },
                format: "headerFormatter",
            },
            {
                selector: "h3",
                options: {
                    uppercase: false
                },
                format: "headerFormatter",
            },
            {
                selector: "blockquote",
                options: {
                    trimEmptyLines: false
                },
                format: "blockFormatter"
            },
            {
                selector: "input[type=checkbox]",
                format: "checkBoxFormatter"
            },
        ],
    };

    return htmlToText(marked.parse(markdown), formatOptions);
}
