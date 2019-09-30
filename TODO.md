# Work to be done

GitGitGadget is a live Open Source project. As such, it will probably never be
finished. Here are a few features that may materialize at some stage, organized
into a few categories (listed by priority, most important tasks first).

## Tasks that would be really nice to have, too, time permitting

- The "What's cooking" mails talk about the branches, stating e.g. when a
  "re-roll is expected". The PR should be updated with that information.
- If there is any unfinished Check, GitGitGadget should set a flag, and listen
  to the Check events and send the patch series upon success (and refuse to send
  it upon failure).
- Add a new `/suggest reviewers` feature that will automatically generate a
  list of potential reviewers. An example script
  [git-reviewers](https://gist.github.com/alekstorm/4949628/) exists that could
  be used as a model.

## Future work

- Sometimes, the patches are amended before they are applied. In these cases, it
  is really helpful to know about that, therefore GitGitGadget should use
  the `range-diff` command to inform the contributor about this, so that
  subsequent iterations of the patch submission do not revert those amendments.
- Comments on the PR should be sent as mails responding to the best-matching
  mail.
- Simple issues, such as overly-long lines, or short commit messages, or missing
  `Signed-off-by:` lines could be detected and pointed out by GitGitGadget, and
  where possible, a fixed branch should be pushed, ready for the contributor to
  reset to.
- A label could be added automatically to indicate whether the PR's branch
  was changed since it was last submitted, and what is the latest sent
  iteration. Possibly also a label could be auto-created with the first Git
  version that carries the patches in this PR.
