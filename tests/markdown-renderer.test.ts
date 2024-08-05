/* eslint-disable max-len */
import { expect, test } from "@jest/globals";
import { md2text } from "../lib/markdown-renderer.js";

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

test("Markdown rendering blockquote test", () => {
const bq1 = `No wrap on 75 chars

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5`;
    expect(md2text(bq1)).toEqual(`No wrap on 75 chars

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5`);

const bq2 = `Exactly 76 chars should be allowed:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 90 2 4 6`;
    expect(md2text(bq2)).toEqual(`Exactly 76 chars should be allowed:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 90 2 4 6`);

const bq3 = `Wrap on 77 chars:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7`;
    expect(md2text(bq3)).toEqual(`Wrap on 77 chars:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
> 7`);

const bq4 = `Third level quote wrap on 77 chars:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>>> 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7`;
    expect(md2text(bq4)).toEqual(`Third level quote wrap on 77 chars:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>
>>> 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>>> 7`);

const bq5 = `76 - 20 = 56 levels:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 89 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7`;
    expect(md2text(bq5)).toEqual(`76 - 20 = 56 levels:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 89 1 3 5 7 9 1 3 5 7
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 9 1 3 5 7 9 1 3 5 7
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 9 1 3 5 7 9 1 3 5 7
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 9 1 3 5 7`);

const bq6 = `Over 56 levels still has 20 char:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7`;
    expect(md2text(bq6)).toEqual(`Over 56 levels still has 20 char:

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 5 7 9 1
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 5 7 9 1
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 5 7 9 1
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7`);

const bq7 = `Over 56 levels still has 20 char (exact):

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 56 8 0 23 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7`;
    expect(md2text(bq7)).toEqual(`Over 56 levels still has 20 char (exact):

> 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5 7 9 1 3 5
>
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 56 8 0
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 23 5 7 9 1 3 5 7 9 1
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7 9 1 3 5 7 9 1
>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 3 5 7`);
});

test("task lists are rendered correctly", () => {
    const taskList = `This is a task list:
* [x] done item
* [ ] item still to do`;
    expect(md2text(taskList)).toEqual(`This is a task list:

 * [x] done item
 * [ ] item still to do`);
});