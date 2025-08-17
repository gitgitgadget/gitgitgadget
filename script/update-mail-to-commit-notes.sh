#!/bin/sh

# This is a very simple helper to assist with finding the commit in git.git (if
# any) corresponding to a given mail.
#
# It makes use of the commit-to-mail notes and updates a reverse-mapping. To
# use it, call:
#
#	hash="$(echo "$MESSAGE_ID" | git hash-object --stdin)"
#	git notes --ref=refs/notes/mail-to-commit show $hash

die () {
	echo "$*" >&2
	exit 1
}

test -n "$GITGIT_DIR" ||
GITGIT_DIR="$(dirname "$0")/../.git/git-worktree"
git_remote="${GITGIT_GIT_REMOTE:-https://github.com/gitgitgadget/git}"

update_gitgit_dir () {
	test -d "$GITGIT_DIR" ||
	git clone $git_remote "$GITGIT_DIR" ||
	die "Could not clone $git_remote to $GITGIT_DIR"

	git -C "$GITGIT_DIR" fetch $git_remote \
		refs/notes/mail-to-commit:refs/notes/mail-to-commit ||
	die "Could not update notes"
}

update_mail_to_commit_notes () {
	oneline="$(git -C "$GITGIT_DIR" show -s --format=%s refs/notes/mail-to-commit^{/Update.from.commit.range})" ||
	die "Could not read latest oneline"
	from="$(git -C "$GITGIT_DIR" rev-parse refs/notes/commit-to-mail^{/"$oneline"})" ||
	die "Could not determine range start"
	range="$from"..refs/notes/commit-to-mail
	notecounter=0
	for notecommit in $(git -C "$GITGIT_DIR" rev-list --reverse "$range")
	do
		notecounter=$(($notecounter+1))
		oneline="$(git -C "$GITGIT_DIR" show -s --format=%s $notecommit)"
		cat <<-EOH
		commit refs/notes/mail-to-commit
		committer $(git -C "$GITGIT_DIR" var GIT_COMMITTER_IDENT)
		data <<EOF
		$oneline
		EOF
		EOH
		test $notecounter -gt 1 || echo "from refs/notes/mail-to-commit^0"

		counter=0
		git -C "$GITGIT_DIR" show --no-renames --format=%% $notecommit |
		sed -n '/^---/{
			N;
			s/\///g;
			N;
			s/\n@@.*//;
			N;
			/^-/N;
			s/\ndiff --git .*//;
			y/\n/ /;
			s/^--- a\([^ ]*\) +++ devnull *-\(.*\)/- \2 \1/p;
			s/^--- devnull +++ b\([^ ]*\) +\(.*\)/+ \2 \1/p;
		}' |
		sort -R | # ensure that - lines come before + lines
		while read marker mid commit
		do
			counter=$(($counter+1))
			printf "%d/%d\r" $notecounter $counter >&2
			hash="$(echo "$mid" |
				git -C "$GITGIT_DIR" hash-object --stdin)"
			hashpath="${hash#??}"
			hashpath="${hash%$hashpath}/$hashpath"
			case "$marker" in
			-) printf 'D %s\n' "$hashpath";;
			+) printf 'M 100644 inline %s\ndata <<EOF\n%s\nEOF\n' "$hashpath" "$commit";;
			esac
		done
	done |
	git -C "$GITGIT_DIR" fast-import
}

update_gitgit_dir &&
update_mail_to_commit_notes ||
die "Could not update refs/notes/mail-to-commit"
