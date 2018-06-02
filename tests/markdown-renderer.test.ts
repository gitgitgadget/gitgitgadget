import "jest";
import { md2text } from "../lib/markdown-renderer";

const md = `# Welcome to GitGitGadget
A paragraph with [links](https://gitgitgadget.github.io/), with

* a
* list
* of
* items that might span more than seventy-six characters in a single item ${
    ""}and therefore needs to be wrapped.`;

test("Markdown rendering test", () => {
    expect(md2text(md)).toEqual(`Welcome to GitGitGadget
=======================

A paragraph with links [https://gitgitgadget.github.io/], with

 * a
 * list
 * of
 * items that might span more than seventy-six characters in a single item
   and therefore needs to be wrapped.`);
});
