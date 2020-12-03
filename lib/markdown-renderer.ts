import { htmlToText, HtmlToTextOptions } from "html-to-text";
import marked from "marked";

// Provide our own renderings of headings and block quotes.

export function md2text(markdown: string, columns = 76): string {

    const headerOptions =  {
                options: {
                    uppercase: false
                },
                format: "headerFormatter",
            };

    let quoteDepth = 0;
    const formatOptions: HtmlToTextOptions = {
        wordwrap: columns,
        formatters: {
            headerFormatter: (elem, walk, builder, options) => {
                builder.openBlock(options.leadingLineBreaks || 2);
                walk(elem.children, builder);
                builder.closeBlock(options.trailingLineBreaks || 2,
                    str => {
                        const underline = str.substr(str.lastIndexOf("\n") + 1)
                            .replace(/./g, "=");
                        return `${str}\n${underline}`;
                    });
            },
            blockFormatter: (elem, walk, builder, options) => {
                builder.openBlock(options.leadingLineBreaks || 2,
                    quoteDepth? 1 : 2);
                quoteDepth++;
                walk(elem.children, builder);
                quoteDepth--;
                builder.closeBlock(options.trailingLineBreaks || 2,
                    str => { return str
                        .replace(/^>/mg, ">>") // add to quote
                        .replace(/^(?!>|$)/mg, "> ")   // new quote
                        .replace(/(^|\n)(\n)(?!$)/g, "$1>$2") // quote empty
                    });
            },
        },
        tags: {
            a: {
                options: {
                    hideLinkHrefIfSameAsText: true,
                },
            },
            h1: headerOptions,
            h2: headerOptions,
            h3: headerOptions,
            blockquote: {
                options: {
                    trimEmptyLines: false
                },
                format: "blockFormatter",
            },
        },
    };

    return htmlToText(marked(markdown), formatOptions);
}
