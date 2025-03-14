# Welcome to [GitGitGadget](https://gitgitgadget.github.io/)

Hi @${username}, and welcome to GitGitGadget, the GitHub App to send patch series to the Git mailing list from GitHub Pull Requests.

Please make sure that either:

- Your Pull Request has a good description, if it consists of multiple commits, as it will be used as cover letter.
- Your Pull Request description is empty, if it consists of a single commit, as the commit message should be descriptive enough by itself.

You can CC potential reviewers by adding a footer to the PR description with the following syntax:

    CC: Revi Ewer <revi.ewer@example.com>, Ill Takalook <ill.takalook@example.net>

NOTE: DO NOT copy/paste your CC list from a previous GGG PR's description,
because it will result in a malformed CC list on the mailing list. See
[example](https://lore.kernel.org/git/owly4jd741ph.fsf@fine.c.googlers.com/).

Also, it is a good idea to review the commit messages one last time, as the Git project expects them in a quite specific form:

* the lines should not exceed 76 columns,
* the first line should be like a header and typically start with a prefix like "tests:" or "revisions:" to state which subsystem the change is about, and
* the commit messages' body should be [describing the "why?" of the change](https://git-scm.com/docs/SubmittingPatches#describe-changes).
* Finally, the commit messages should end in a [Signed-off-by:](https://git-scm.com/docs/SubmittingPatches#dco) line matching the commits' author.

It is in general a good idea to await the automated test ("Checks") in this Pull Request before contributing the patches, e.g. to avoid trivial issues such as unportable code.

## Contributing the patches

Before you can contribute the patches, your GitHub username needs to be added to the list of permitted users. Any already-permitted user can do that, by adding a comment to your PR of the form `/allow`. A good way to find other contributors is to locate recent pull requests where someone has been `/allow`ed:

* [Search: is:pr is:open "/allow"](https://github.com/gitgitgadget/git/pulls?utf8=%E2%9C%93&q=is%3Apr+is%3Aopen+%22%2Fallow%22)

Both the person who commented `/allow` and the PR author are able to `/allow` you.

An alternative is the channel [`#git-devel`](https://web.libera.chat/#git-devel) on the Libera Chat IRC network:

    <newcontributor> I've just created my first PR, could someone please /allow me? https://github.com/gitgitgadget/git/pull/12345
    <veteran> newcontributor: it is done
    <newcontributor> thanks!

Once on the list of permitted usernames, you can contribute the patches to the Git mailing list by adding a PR comment `/submit`.

If you want to see what email(s) would be sent for a `/submit` request, add a PR comment `/preview` to have the email(s) sent to you.  You must have a public GitHub email address for this. Note that any reviewers CC'd via the list in the PR description will *not* actually be sent emails.

After you submit, GitGitGadget will respond with another comment that contains the link to the cover letter mail in the Git mailing list archive. Please make sure to monitor the discussion in that thread and to address comments and suggestions (while the comments and suggestions will be mirrored into the PR by GitGitGadget, you will still want to [reply via mail](https://gitgitgadget.github.io/reply-to-this)).

If you do not want to subscribe to the Git mailing list just to be able to respond to a mail, you can download the mbox from the [Git mailing list archive](https://lore.kernel.org/git) (click the `(raw)` link), then import it into your mail program. If you use GMail, you can do this via:

```sh
curl -g --user "<EMailAddress>:<Password>" \
    --url "imaps://imap.gmail.com/INBOX" -T /path/to/raw.txt
```

To iterate on your change, i.e. send a revised patch or patch series, you will first want to (force-)push to the same branch. You probably also want to modify your Pull Request description (or title). It is a good idea to summarize the revision by adding something like this to the cover letter (read: by editing the first comment on the PR, i.e. the PR description):

```
Changes since v1:
- Fixed a typo in the commit message (found by ...)
- Added a code comment to ... as suggested by ...
...
```

To send a new iteration, just add another PR comment with the contents: `/submit`.

## Need help?

New contributors who want advice are encouraged to join [git-mentoring@googlegroups.com](https://groups.google.com/forum/#!forum/git-mentoring), where volunteers who regularly contribute to Git are willing to answer newbie questions, give advice, or otherwise provide mentoring to interested contributors. You must join in order to post or view messages, but anyone can join.

You may also be able to find help in real time in the developer IRC channel, [`#git-devel`](https://web.libera.chat/#git-devel) on Libera Chat. Remember that IRC does not support offline messaging, so if you send someone a private message and log out, they cannot respond to you. The scrollback of `#git-devel` is [archived](https://colabti.org/irclogger//irclogger_logs/git-devel), though.
