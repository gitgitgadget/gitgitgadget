# Contributing git.git patches via GitHub PRs

This project's goal is to make contributions to the Git project (almost) as easy as opening a GitHub PR. The idea is for users to open a Pull Request at

    https://github.com/gitgitgadget/git

with a good description of their patch series. Then, the command `/submit`,
issued via a comment on said PR will tell GitGitGadget to send the patches as
mail thread to [the Git mailing list](mailto:git@vger.kernel.uorg), with the
Pull Request's description as cover letter.

As is common, reviewers on the Git mailing list will probably ask for
modifications. These should be folded into the respective commits (or inserted
as stand-alone commits at an appropriate place in the patch series) via `git
rebase -i`, followed by a force-push. Once everything is in a good shape,
update the description to include information about changes performed relative
to the latest patch series iteration, and then another `/submit` will ask
GitGitGadget to send a new iteration of the patch series.

All relevant information, such as the current iteration of the patch series,
the Message-ID of the sent mails, etc is stored in the Git notes in
`refs/notes/gitgitgadget`.

Note: GitGitGadget will Cc: the original authors when sending patches on
their behalf, and people mentioned in the Cc: footer of the Pull Request
description.

Furthermore, for all iterations of a patch series but the first one,
GitGitGadget will insert a machine-generated representation of what changed
between revisions,
and reply to the cover letter of the previous iteration.  This patch revision
diff can be suppressed if the change may be too large or irrelevant by adding
a `Range-Diff: false` footer in the Pull Request description.

For convenience of reviewers, GitGitGadget will generate tags for each
iteration it sent, and push those to [https://github.com/gitgitgadget/git](https://github.com/gitgitgadget/git). Links
to those tags will be included in the cover letter.
