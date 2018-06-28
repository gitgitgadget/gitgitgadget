# Work to be done

GitGitGadget is a live Open Source project. As such, it will probably never be
finished. Here are a few features that may materialize at some stage, organized
into a few categories (listed by priority, most important tasks first).

## These tasks should be the focus immediately after GitGitGadget works

- suppress the `Cc: GitGitGadget` and the first body line `From: GitGitGadget` in the cover letter
- Cc: the GitHub user who issued `/submit` on the cover letter
- handle the `/allow <user>` and `/disallow <user>` commands
- upon Probot-type of launch, verify that the base branch is one of "maint", "master", "next" or "pu"
- add a hard-coded test verifying that GitGitGadget is only called from
  gitgitgadget/git
- write tests that verify that a Probot-type of load is handled correctly

## Tasks that would be really nice to have, too, time permitting

- The branches merged into `pu` are also pushed individually to
  https:/github.com/gitster/git. We will want to add a comment to the PR every
  time this branch is pushed, and update the Git note corresponding to the
  respective PR.
- When patches are accepted into the `pu` branch of
  <https://github.com/git/git,> the `refs/notes/amlog` branch in
  https:/github.com/gitster/git will map the blob with the content `Message-Id:
  <message-id>` (corresponding to the mail that contained that patch) to the
  commit, as applied into <https://github.com/git/git.> We could add a [GitHub
  commit status](https://developer.github.com/v3/repos/statuses/) with a link to
  the commit in the latter repository.
- The "What's cooking" mails talk about the branches, stating e.g. when a
  "re-roll is expected". The PR should be updated with that information.
- Once the branch has been integrated into the `master` branch of
  <https://github.com/git/git,> the PR could be "closed via [commit]".
- We should add some Continuous Testing, in the least building and testing on
  Windows, macOS and Linux. The result will be automatically added as a Check to
  the corresponding tip commit if we use VSTS Build (which we should).
- GitGitGadget should refuse to send patch series if there was any failing Check
  (i.e. failed VSTS build).
- If there is any unfinished Check, GitGitGadget should set a flag, and listen
  to the Check events and send the patch series upon success (and refuse to send
  it upon failure).
- Add a new `/suggest reviewers` feature that will automatically generate a
  list of potential reviewers.  An example script [git-reviewers](https://gist.github.com/alekstorm/4949628/)
  exists that could be used as a model.

## Future work

- Sometimes, the patches are amended before they are applied. In these cases, it
  is really helpful to know about that, therefore GitGitGadget should use
  the upcoming
  [`range-diff`](https://public-inbox.org/git/cover.1525361419.git.johannes.schindelin@gmx.de/)
  or whatever the builtin will be called) to inform the contributor about this,
  so that subsequent iterations of the patch submission do not revert those
  amendments.
- Answers to the mails should ideally be attached as answers to the PR.
- Answers that comment on the quoted diff should ideally be attached to the diff
  of the PR at the corresponding line.
- Comments on the PR should be sent as mails responding to the best-matching
  mail.
- Simple issues, such as overly-long lines, or short commit messages, or missing
  `Signed-off-by:` lines could be detected and pointed out by GitGitGadget, and
  where possible, a fixed branch should be pushed, ready for the contributor to
  reset to.
- A label could be added automatically to indicate whether the PR's branch
  was changed since it was last submitted, which of the `pu`, `next`,
  `master` or `maint` branch contain the "merged" patches, and what is the
  latest sent iteration. Possibly also a label could be auto-created with the
  first Git version that carries the patches in this PR.
