#!/bin/bash

# This script is intended to help submit patch series to projects which
# want contributions to be sent to a mailing list. The process is not
# quite as painless for the contributor as opening Pull Requests, but at
# least it is much less painful than having to all the steps manually.
#
# Example usage:
#
#	/path/to/mail-patch-series.sh
#
# (All relevant information, such as the mailing list to which this patch series
# needs to be sent, the current iteration of the patch series, etc is inferred
# from the current branch in the current repository.)
#
# Currently, this script supports submitting patch series (or single
# patches) to only two projects: Git and Cygwin, with the upstream remotes
# being called 'junio' and 'cygwin', respectively.
#
# To make use of this script, you first have to have a topic branch. It
# needs to be rebased to the latest `master` (or `next` in the case of Git).
#
# Further, you need an alias called `send-mbox` that takes an mbox on stdin and
# puts the individual mails into the Drafts folder of your maildir, ready to
# send. Example for alias.send-mbox:
#
# [alias]
#    send-mbox = !git mailsplit -o\"$HOME\"/Mail/Drafts/new
#
# When running this script on a newer iteration of the same topic branch, it
# will detect that and use the appropriate [PATCH v<iteration>] prefix.
#
# This script will also use the branch description as cover letter. Unlike
# plain format-patch, the first line will be used as subject and the rest as
# mail body, without any ugly "*** Subject/Blurb here ***".
#
# Note that this script will demand a branch description (which can be added or
# edited using `git branch --edit-description`) if the current topic branch
# contains more that a single patch; For single-patch "series", the branch
# description is optional.
#
# This script will also try to Cc: original authors when sending patches on
# their behalf, and people mentioned in the Cc: footer of commit messages.
#
# To Cc: the entire patch series to, say, reviewers who commented on some
# iteration of the patch series, the script supports being called with the
# `--cc 'R E Viewer <reviewer@email.com>'` option; This information is then
# stored in the config, and used when sending the next iteration.
#
# Furthermore, for a second or later iteration of a patch series, this script
# will insert an interdiff, and reply to the cover letter of the previous
# iteration. It stores the relevant information in local tags whose names
# reflect the branch name and the iterarion. This tag is relevant in particular
# for the interdiff, as that revision may need to be rebased for a proper
# interdiff (in this case, a tag is generated whose name is of the form
# <branch>-v<iteration>-rebased).
#
# Lastly, if the mail.publishtoremote is set in the config, the branch as well
# as the generated tag(s) will be pushed to the remote of that name. If this
# remote's URL points to GitHub, the URL to the tag will be sent together with
# the patch series.
#
# If anything goes awry, an iteration can be regenerated/resent with the
# `--redo` option.

die () {
	echo "$*" >&2
	exit 1
}

test -n "$(git config alias.send-mbox)" ||
die "Need an 'send-mbox' alias"

# figure out the iteration of this patch series
branchname="$(git rev-parse --symbolic-full-name HEAD)" &&
shortname=${branchname#refs/heads/} &&
test "a$branchname" != "a$shortname" ||
die "Not on a branch? $branchname"

redo=
publishtoremote="$(git config mail.publishtoremote)"
while test $# -gt 0
do
	case "$1" in
	--redo)
		redo=t
		;;
	--publish-to-remote=*)
		publishtoremote=${1#*=}
		;;
	--cc)
		shift
		case "$*" in
		*\>*\>*|*\>,)
			echo "$*" |
			sed -e 's/[^ ]*: //g' -e 'y/,/\n/' -e 's/> />\n/g' |
			sed -e 's/ *//' -e 's/ $//' -e 's/^ //' -e '/^$/d' |
			xargs -r -n 1 -d \\n \
				git config --add branch."$shortname".cc
			exit
			;;
		*)
			exec git config --add branch."$shortname".cc "$*"
			;;
		esac
		;;
	*)
		break
		;;
	esac
	shift
done

test $# = 0 ||
die "Usage: $0"' [--redo] [--publish-to-remote=<remote>] |
	--cc <email-address>'

test -z "$publishtoremote" ||
test -n "$(git config remote."$publishtoremote".url)" ||
die "No valid remote: $publishtoremote"

# For now, only the Git and Cygwin projects are supported
if git rev-parse --verify e83c5163316f89bfbde >/dev/null
then
	# Git
	to="--to=git@vger.kernel.org"
	cc="--cc=\"Junio C Hamano <gitster@pobox.com>\""
	upstreambranch=junio/next
	test -z "$(git rev-list $branchname..$upstreambranch)" ||
	upstreambranch=junio/master
elif git rev-parse --verify a3acbf46947e52ff596 >/dev/null
then
	# Cygwin
	to="--to=cygwin-patches@cygwin.com"
	cc=
	upstreambranch=cygwin/master
else
	die "Unrecognized project"
fi

test -z "$(git rev-list $branchname..$upstreambranch)" ||
die "Branch $shortname is not rebased to $upstreambranch"

# Cc: from config
cc="$cc $(git config --get-all branch.$shortname.cc |
	sed 's/.*/--cc="&"/')" ||
die "Could not get Cc: list from config"

latesttag="$(git for-each-ref --format='%(refname)' \
		--sort=-taggerdate refs/tags/"$shortname-v*[0-9]" |
	sed -n $(echo "$redo" | wc -c)p)"
if test -z "$latesttag"
then
	patch_no=1
	subject_prefix=
	in_reply_to=
	interdiff=
else
	test -n "$(git rev-list $branchname...$latesttag)" ||
	die "Branch $shortname was already submitted: $latesttag"

	patch_no=$((${latesttag##*-v}+1))
	subject_prefix="--subject-prefix=\"PATCH v$patch_no\""
	in_reply_to="$(git cat-file tag "$latesttag" |
		tac | sed '/^$/q' |
		sed -n 's|.*http://mid.gmane.org/|--in-reply-to=|p')"

	if test -z "$(git rev-list $latesttag..$upstreambranch)"
	then
		interdiff="$(git diff $latesttag..$branchname)"
	else
		rebasedtag=$latesttag-rebased
		if git rev-parse --verify $rebasedtag >/dev/null 2>&1
		then
			if test -n "$(git rev-list \
				$rebasedtag..$upstreambranch)"
			then
				echo "Re-rebasing $rebasedtag" >&2
				git checkout $rebasedtag^0 &&
				git rebase $upstreambranch &&
				git tag -f -a ${rebasedtag#refs/tags/} &&
				if test -n "$publishtoremote"
				then
					git push "$publishtoremote" \
						+"$rebasedtag" ||
					echo "Couldn't publish $rebasedtag" >&2
				fi &&
				git checkout $shortname ||
				die "Could not re-rebase $rebasedtag"
			fi
		else
			# Need rebasing
			echo "Rebasing $latesttag" >&2
			git checkout $latesttag^0 &&
			git rebase $upstreambranch &&
			git cat-file tag $latesttag |
			sed '1,/^$/d' |
			git tag -F - -a ${rebasedtag#refs/tags/} &&
			if test -n "$publishtoremote"
			then
				git push "$publishtoremote" "$rebasedtag" ||
				echo "Couldn't publish $rebasedtag" >&2
			fi &&
			git checkout $shortname ||
			die "Could not re-rebase $rebasedtag"
		fi
		interdiff="$(git diff $rebasedtag..$branchname)"
	fi ||
	die "Could not generate interdiff"
fi

# Auto-detect whether we need a cover letter
cover_letter=
if test -n "$(git config branch.$shortname.description)"
then
	cover_letter=--cover-letter
elif test 1 -lt $(git rev-list --count $upstreambranch..$branchname)
then
	die "Branch $shortname needs a description"
fi

mbox="$(eval git format-patch $subject_prefix $in_reply_to \
	$cover_letter $to $cc \
	--add-header='"Content-Type: text/plain; charset=UTF-8"' \
	--add-header='"Fcc: Sent"' --thread --stdout \
	--base $upstreambranch \
	$upstreambranch..$branchname)" ||
die "Could not generate mailbox"

# Add Cc: and explict From: lines for different authors, if needed
thisauthor="$(git var -l | sed -n 's/^GIT_AUTHOR_IDENT=\([^>]*>\).*/\1/p')"
otherauthors="$(git log -s --format='%an <%ae>' $upstreambranch..$branchname |
	grep -v "^$thisauthor$")"
if test -n "$otherauthors"
then
	test -z "$(git log -s --format=%b $upstreambranch..$branchname |
		grep '^From: .*>$')" ||
	die "Bogus From: line in commit message"

	mbox="$(echo "$mbox" | sed -e '
	 /^From: .*>$/{
	   /^From: '"$thisauthor"'$/b

	   :1
	   N
	   /[^\n]$/b1

	   /\nCc: /b2

	   s/^\(From: \)\([^>]*\)\(.*\)\n/\1'"$thisauthor"'\3\nCc: \2\n\n\1\2\n/
	   b

	   :2
	   s/^\(From: \)\([^>]*>\)\(.*\nCc: \)\(.*\)/\1'"$thisauthor"'\3\2, \4\n\1\2\n/
	  }')"
fi

# Fix Subject line
test -z "$cover_letter" ||
mbox="$(echo "$mbox" | sed -e \
	'/^Subject:/{:1;N;/[^\n]$/b1;N;N;N;N;s/^\([^]]*\] \)\*\*\* [^\n]*\(.*\)\n\n\*\*\*[^\n]*\n\n\(.*\)\n$/\1\3\2\n/;:2;n;b2}')" ||
die "Could not post-process cover letter"

# tag
if test -z "$cover_letter"
then
	tagmessage="$(git cat-file commit $branchname |
		sed '1,/^$/d')"
else
	tagmessage="$(echo "$mbox" |
		sed -n -e 's/^Subject: [^]]*] //p' \
			 -e '/^$/{:1;p;n;/./b1;p;n;/^-- $/q;b1}')"
fi

# insert public link into mail
if test -n "$publishtoremote"
then
	url="$(git config remote."$publishtoremote".url)"
	case "$url" in
	http://github.com/*|https://github.com/*)
		url="https:${url#*:}"
		;;
	github.com:*|git@github.com:*)
		url="https://github.com/${url#*:}"
		;;
	*)
		url=
		;;
	esac
	if test -n "$url"
	then
		url="Published-As: $url/releases/tag/$shortname-v$patch_no"
		mbox="$(echo "$mbox" |
			if test -z "$cover_letter"
			then
				sed "/^---$/a$url"
			else
				sed '/^-- $/{
					i'"$url"'
					:1;n;b1
				}'
			fi)"
	fi
fi

printf "%s\n\nSubmitted-As: http://mid.gmane.org/%s\n%s" \
	"$tagmessage" \
	"$(echo "$mbox" | sed -n \
		'/^Message-Id: /{s/[^:]*: <\(.*\)>/\1/p;q}')" \
	"$(echo "$in_reply_to" | tr ' ' '\n' | sed -n \
		's|--in-reply-to=|In-Reply-To: http://mid.gmane.org/|p')" |
git tag -F - $(test -z "$redo" || echo "-f") -a \
	"$shortname-v$patch_no" ||
die "Could not tag $shortname-v$patch_no"

# Insert interdiff
test -z "$interdiff" ||
mbox="$(echo "$mbox" |
	sed "$(if test -z "$cover_letter"
		then
			echo '/^---$/{:2;n;/./b2;'
		else
			echo '/^-- $/{'
		fi)"'i'"Interdiff vs v$(($patch_no-1)):"'\
\
'"$(echo "$interdiff" | sed -e 's/^/ /' -e 's/\\/&&/g' -e 's/$/\\/')"'

:1;n;b1}')"

# Send (originally: automatically add to drafts)
echo "$mbox" | git send-mbox ||
die "Error running 'send-mbox'"

# Publish
test -z "$publishtoremote" ||
git push "$publishtoremote" +"$branchname" \
	$(test -z "$redo" || echo +)"$shortname-v$patch_no" ||
die "Could not publish $branchname and $shortname-v$patch_no"
