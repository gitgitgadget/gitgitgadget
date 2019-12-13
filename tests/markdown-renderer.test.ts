import "jest";
import { md2text } from "../lib/markdown-renderer";

const md = `# Welcome to GitGitGadget
A paragraph with [links](https://gitgitgadget.github.io/), with

* a
* list
* of
* items that might span more than seventy-six characters in a single item ${
    ""}and therefore needs to be wrapped.

> Starting a block quote.
>
>> Previously quoted ipsum loren.

> Back to the base quote.`;

test("Markdown rendering test", () => {
    expect(md2text(md)).toEqual(`Welcome to GitGitGadget
=======================

A paragraph with links [https://gitgitgadget.github.io/], with

 * a
 * list
 * of
 * items that might span more than seventy-six characters in a single item
   and therefore needs to be wrapped.

> Starting a block quote.
>
>> Previously quoted ipsum loren.

> Back to the base quote.`);
});
