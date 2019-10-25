# Contributing

[fork]: https://github.com/gitgitgadget/gitgitgadget/fork
[pr]: ../../compare
[style]: https://palantir.github.io/tslint/
[code-of-conduct]: CODE_OF_CONDUCT.md
[TODO]: TODO.md

Hi there! We're thrilled that you'd like to contribute to this project. Your help is essential for keeping it great.

Please note that this project is released with a [Contributor Code of Conduct][code-of-conduct]. By participating in this project you agree to abide by its terms.

Now, if you are looking for ideas what you could improve in GitGitGadget, there is an extensive [TODO][TODO] list. If you want to add your idea to that TODO list, that's fine, too!

Most likely you read this because you want to Get Started hacking on GitGitGadget, right? Probably the best way is to install [VS Code](https://code.visualstudio.com/) (no worries, it is Open Source and works out of the box on Linux, macOS and Windows).
And if you want to dive into the source code to Get Things Done, here is a little overview what is done where:

## A bird eye's view of GitGitGadget's source code

The most important part of the source code lives in `lib/`, and is written in Typescript. This is where the core logic lives, from processing the Pull Request metadata (`lib/gitgitgadget.ts`) to calling Git (`lib/git.ts`) to generating the patch series (`lib/patch-series.ts`) to sending the emails (`lib/send-emails.ts`).

The exception to that rule are scripts, such as `ci-helper.ts` which backs the Azure Pipeline that is implicitly triggered via the GitHub App, which live in `scripts/`.

The tests to verify that everything works as expected live in `tests/`, and use the [Jest](https://facebook.github.io/jest/) framework. Please make sure to add tests for whatever functionality you add when developing a new feature, to gain confidence that your feature or bug fix will work also in the future.

If you never developed any node.js or Typescript project: you will need to get the dependencies via `npm install`, and you will want to run the tests via `npm run test`.

Happy coding!

## Submitting a pull request

1. [Fork][fork] and clone the repository
1. Configure and install the dependencies: `npm install`
1. Make sure the tests pass on your machine: `npm test`, note: these tests also apply the linter, so no need to lint separately
1. Create a new branch: `git checkout -b my-branch-name`
1. Make your change, add tests, and make sure the tests still pass
1. Push to your fork and [submit a pull request][pr] (click "compare across forks")
1. Pat your self on the back and wait for your pull request to be reviewed and merged.

Here are a few things you can do that will increase the likelihood of your pull request being accepted:

- Follow the [style guide][style] which is using standard. Any linting errors should be shown when running `npm test`
- Write and update tests.
- Keep your change as focused as possible. If there are multiple changes you would like to make that are not dependent upon each other, consider submitting them as separate pull requests.
- Write a [good commit message](http://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html).

Work in Progress pull request are also welcome to get feedback early on, or if there is something blocked you.

## Resources

- [How to Contribute to Open Source](https://opensource.guide/how-to-contribute/)
- [Using Pull Requests](https://help.github.com/articles/about-pull-requests/)
- [GitHub Help](https://help.github.com)
