# A helper for mailing list-based patch submissions

This script is intended to help submit patch series to projects which
want contributions to be sent to a mailing list. The process is not
quite as painless for the contributor as opening Pull Requests, but at
least it is much less painful than having to all the steps manually.

Example usage:

```sh
/path/to/mail-patch-series.sh
```

(All relevant information, such as the mailing list to which this patch series
needs to be sent, the current iteration of the patch series, etc is inferred
from the current branch in the current repository.)

Currently, this script supports submitting patch series (or single
patches) to only two projects: Git and Cygwin, with the upstream remotes
being called 'junio' and 'cygwin', respectively.

To make use of this script, you first have to have a topic branch. It
needs to be rebased to the latest `master` (or `next` in the case of Git).

Further, you need an alias called `send-mbox` that takes an mbox on stdin and
puts the individual mails into the Drafts folder of your maildir, ready to
send. Example for alias.send-mbox:

```ini
[alias]
   send-mbox = !git mailsplit -o\"$HOME\"/Mail/Drafts/new
```

When running this script on a newer iteration of the same topic branch, it
will detect that and use the appropriate `[PATCH v<iteration>]` prefix.

This script will also use the branch description as cover letter. Unlike
plain format-patch, the first line will be used as subject and the rest as
mail body, without any ugly "\*\*\* Subject/Blurb here \*\*\*".

Note that this script will demand a branch description (which can be added or
edited using `git branch --edit-description`) if the current topic branch
contains more that a single patch; For single-patch "series", the branch
description is optional.

This script will also try to Cc: original authors when sending patches on
their behalf, and people mentioned in the Cc: footer of commit messages.

To Cc: the entire patch series to, say, reviewers who commented on some
iteration of the patch series, the script supports being called with the
`--cc 'R E Viewer <reviewer@email.com>'` option; This information is then
stored in the config, and used when sending the next iteration.

Furthermore, for a second or later iteration of a patch series, this script
will insert an interdiff, and reply to the cover letter of the previous
iteration. It stores the relevant information in local tags whose names
reflect the branch name and the iterarion. This tag is relevant in particular
for the interdiff, as that revision may need to be rebased for a proper
interdiff (in this case, a tag is generated whose name is of the form
`<branch>-v<iteration>-rebased`).

Lastly, if `mail.publishtoremote` is set in the config, the branch as well
as the generated tag(s) will be (force) pushed to the remote of that name. If
this remote's URL points to GitHub, the URL to the tag will be sent together
with the patch series.

If anything goes awry, an iteration can be regenerated/resent with the
`--redo` option.
