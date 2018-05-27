# GitGitGadget

## Goal

GitGitGadget is intended to help with the code contribution process of the Git
project itself.

### Background

Git's code contribution process follows the example of the Linux development
(that is also used in other projects such as Cygwin, BusyBox etc): centered
around one mailing list ([git@vger.kernel.org](mailto:git@vger.kernel.org)),
everything is discussed in one place (except security bugs, which are handled at
[git-security@googlegroups.com](mailto:git-security@googlegroups.com), i.e. yet
another mailing list):

- bug reports,
- request for help,
- questions about design decisions,
- feature requests,
- mentoring new contributors, and
- patch submissions.

That's right: Git's development uses Git on the contributors' side and on the
maintainer side, yet the code is transferred via mail between contributors and
the maintainer. Most notably, there is no codified review process other than the
free-form discussion via mails, and the convenience of Pull Requests and
web-based code review is completely missing.

As a consequence, code submissions are therefore frequently reviewed purely
based on the patches, without taking any context into account other than what
was provided in the mail sent by the submitter.

Another consequence is that contributors often miss that they are expected to
respond or work more on their submitted patches, as the current status of any
given patch series is described only in one of the bi-weekly "What's cooking"
mails sent by the Git maintainer, which contain not only information about one,
but about all active patch submissions.

Yet another consequence of requiring contributors to send patches as verbatim,
inlined diffs in mails, and to respond with answers interjected in the quoted
mails (as opposed to, say, top-posting), is that most developers are deterred
enough from contributing fixes that they simply don't (the requirements are in
direct opposition of what both the most popular desktop mail client, Outlook,
and the most popular web-based mail client, GMail, offer).

## GitGitGadget's mission

The idea is to allow developers to contribute patches and interact with the
reviewers by using a very familiar interface: GitHub Pull Requests.

GitGitGadget's job is to send the patches to the Git mailing list in the correct
format.

Hopefully, future versions of GitGitGadget will add more convenience to the dialog.

## Design notes

### Historical context

GitGitGadget was originally modeled after the workflow of one single Git
contributor, Johannes Schindelin, who automated the patch contribution process
via [a shell script](https://github.com/dscho/mail-patch-series).

This process was still too manual, and too limited to one contributor's needs,
and still needed too much manual work to serve as the base for any other
developer's needs.

To remedy this, the shell script was first converted into a node.js script, and
then into a Typescript project with the intention to turn this into a hybrid web
application performing its interaction with contributors via GitHub based on the
[Probot](https://probot.github.io) framework and performing its background
maintenance tasks in the form of [Visual Studio Team Services
Builds](https://docs.microsoft.com/en-us/vsts/build-release/index?view=vsts).

### Typescript

The most convenient way to implement a UI based on GitHub Pull Requests is to
use the Probot framework. This framework is implemented in Javascript, and to
allow for type-safe and convenient development, Typescript and Visual Studio
Code are a natural fit.

While many developers may not be familiar with Typescript, it is similar enough
to (and a superset of) Javascript, which is a really well-known language. This
is important, to lower the bar of entry for anybody who finds GitGitGadget
lacking a feature: they can easily implement that feature without having to
learn a completely new language first.

Besides, the node.js ecosystem provides a rich set of support libraries, ready
to use at one's fingertips.

### Main UI

The principal way to interact with GitGitGadget is by opening a Pull Request at
<https://github.com/gitgitgadget/git.> The patch submission is then triggered by
a command given in a single comment to that PR. GitGitGadget will follow up with
a comment describing details of the patch submission, such as the link to the
cover letter in [Git's mailing list archive](https://public-inbox.org/git).

Any other interesting information that can be inferred automatically will be
added in the form of further comments to the same Pull Request.

The idea is to implement this user interface as a web app on Azure, backed by
the repository <https://github.com/gitgitgadget/gitgitgadget> and deployed
automatically.

### Background tasks

The repositories <https://github.com/gitster/git> (and possibly
<https://public-inbox.org/git)> will be monitored via automated builds in Visual
Studio Team Services, backed by Typescript code in
<https://github.com/gitgitgadget/gitgitgadget.>

### Patch submissions

The patches will be submitted in the required form, as mails to the Git mailing
list. The description of the Pull Request will be used as cover letter, after
extracting `Cc:` lines from the footer (if any).

The mails will be sent via the dedicated account gitgitgadget@outlook.com, with
`From: "<author> via GitGitGadget" <gitgitgadget@outlook.com>` headers, and
linking to the corresponding PR/commits on GitHub.

### Storage

GitGitGadget stores its metadata in the form of Git notes, in
`refs/notes/gitgitgadget` in <https://github.com/gitgitgadget/git.>

Note: other Probot-based projects choose to (ab-)use dedicated comments to store
(and possibly hide) their metadata. For GitGitGadget, it was a deliberate
decision not to do that, but rather to use Git notes, not only to keep a record,
and to make debugging easier, but also to be able to fix bugs manually when
necessary.

We follow the same idea as `refs/notes/amlog` in <https://github.com/git/git>
(which inspired this design): first, we add notes of the form
`Message-Id: <message-id>` (but unlike `amlog`, we add it as a note to the tip
of our notes ref, to avoid clashes with existing notes). This ensures that there
is a blob with that content. We can add then any metadata corresponding to the
referenced mail as a note to that blob.

The metadata will be stored in JSON format (sorted by key name).

Metadata includes (but is not limited to): the original commit
(`Submitted-as:`), the commit in <https://github.com/git/git> (`Integrated-as:`),
the Pull Request in <https://github.com/gitgitgadget/git> (`Pull-Request:`), the
latest patch series iteration of which this commit was part (`Iteration:`), etc.
If the identical commit has been submitted as part of (an) earlier patch series
iteration(s), the Message-Ids of the corresponding mails should be also made
available, as `Submitted-as-v<iteration>:`.

Likewise, we will add as notes the URLs of the handled PRs, and in the future
also the URLs of handled PR comments.

Global metadata will be stored in the Git note for the [empty
blob](https://github.com/git/git/blob/v2.17.0/cache.h#L1026-L1027). This
includes all metadata not corresponding to a particular PR, such as a whitelist
of GitHub accounts permitted to use GitGitGadget, the latest commit of
`refs/notes/amlog` that has been processed so far, or the commit in
<https://public-inbox/git> up to which GitGitGadget has parsed the Git mailing
list so far).

To implement some sort of "locking" (to prevent inadvertent concurrent actions
by GitGitGadget), the idea is to update the notes ref first, then push, and
proceed with the actual actions only after the (non-forced) push succeeds.

## Future work

GitGitGadget is a live Open Source project. As such, it will probably never be
finished. Here are a few features that may materialize at some stage:

- Answers to the mails should ideally be attached as answers to the PR.
- Answers that comment on the quoted diff should ideally be attached to the diff
  of the PR at the corresponding line.
- Comments on the PR should be sent as mails responding to the best-matching
  mail.
- When patches are accepted into the `pu` branch of
  <https://github.com/git/git,> the `refs/notes/amlog` branch in
  https:/github.com/gitster/git will map the blob with the content `Message-Id:
  <message-id>` (corresponding to the mail that contained that patch) to the
  commit, as applied into <https://github.com/git/git.> We could add a [GitHub
  commit status](https://developer.github.com/v3/repos/statuses/) with a link to
  the commit in the latter repository.
- The branches merged into `pu` are also pushed individually to
  https:/github.com/gitster/git. We will want to add a comment to the PR every
  time this branch is pushed.
- Sometimes, the patches are amended before they are applied. In these cases, it
  is really helpful to know about that, therefore GitGitGadget should use
  [`tbdiff`](https://github.com/trast/tbdiff) (or the upcoming
  [`branch-diff`](https://public-inbox.org/git/cover.1525361419.git.johannes.schindelin@gmx.de/)
  or whatever the builtin will be called) to inform the contributor about this,
  so that subsequent iterations of the patch submission do not revert those
  amendments.
- Simple issues, such as overly-long lines, or short commit messages, or missing
  `Signed-off-by:` lines could be detected and pointed out by GitGitGadget, and
  where possible, a fixed branch should be pushed, ready for the contributor to
  reset to.
- The "What's cooking" mails talk about the branches, stating e.g. when a
  "re-roll is expected". The PR should be updated with that information.
- Once the branch has been integrated into the `master` branch of
  <https://github.com/git/git,> the PR could be "closed via [commit]".
- A label could be added automatically to indicate whether the PR's branch
  was changed since it was last submitted, which of the `pu`, `next`,
  `master` or `maint` branch contain the "merged" patches, and what is the
  latest sent iteration. Possibly also a label could be auto-created with the
  first Git version that carries the patches in this PR.