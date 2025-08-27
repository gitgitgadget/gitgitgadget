#!/bin/sh

# This is a very simple helper to assist with finding the mail (if any)
# corresponding to a given commit in git.git.

die () {
	echo "$*" >&2
	exit 1
}

mode=print
while case "$1" in
--open) mode=open;;
--reply) mode=reply;;
--notes) mode=notes;;
-*) die "Unknown option: $1";;
*) break;;
esac; do shift; done

test $# = 1 ||
die "Usage: $0 ( ( [--open] | [--reply] ) <commit> | --notes <range> )"

test -n "$LORE_GIT_DIR" ||
LORE_GIT_DIR="$(dirname "$0")/../.git/lore.kernel-git"
test -n "$GITGIT_DIR" ||
GITGIT_DIR="$(dirname "$0")/../.git/git-worktree"

mail_repo="${GITGIT_MAIL_REPO:-https://dev.azure.com/gitgitgadget/git/_git/lore-git}"
mail_remote="${GITGIT_MAIL_REMOTE:-https://lore.kernel.org/git}"
mail_epoch="${GITGIT_MAIL_EPOCH:-/1}"
git_remote="${GITGIT_GIT_REMOTE:-https://github.com/gitgitgadget/git}"

update_mail_archive_dir () {
	test -d "$LORE_GIT_DIR" ||
	git clone --bare $mail_repo "$LORE_GIT_DIR" ||
	die "Could not clone $mail_repo to $LORE_GIT_DIR"

	git -C "$LORE_GIT_DIR" fetch $mail_remote$mail_epoch master:master ||
	die "Could not update $LORE_GIT_DIR to remote's master"

	head="$(git -C "$LORE_GIT_DIR" rev-parse --verify master)" ||
	die "Could not determine tip of master"

	prevhead=
	test ! -f "$LORE_GIT_DIR/"tae-list.latest-rev ||
	prevhead="$(cat "$LORE_GIT_DIR/"tae-list.latest-rev)"

	if test $head != "$prevhead"
	then
		range=${prevhead:+$prevhead..}$head
		echo "Inserting records for $range" >&2
		git -C "$LORE_GIT_DIR" log --format="%at %H %an <%ae>" $range >"$LORE_GIT_DIR/"tae-list.txt.add ||
		die "Could not enumerate $range"

		cat "$LORE_GIT_DIR/"tae-list.txt "$LORE_GIT_DIR/"tae-list.txt.add 2>/dev/null | sort -n | uniq >"$LORE_GIT_DIR/"tae-list.txt.new &&
		mv -f "$LORE_GIT_DIR/"tae-list.txt.new "$LORE_GIT_DIR/"tae-list.txt ||
		die "Could not insert new records"

		echo $head >"$LORE_GIT_DIR/"tae-list.latest-rev
	fi
}

update_gitgit_dir () {
	test -d "$GITGIT_DIR" ||
	git clone $git_remote "$GITGIT_DIR" ||
	die "Could not clone $git_remote to $GITGIT_DIR"

	git -C "$GITGIT_DIR" fetch $git_remote refs/notes/commit-to-mail:refs/notes/commit-to-mail ||
	die "Could not update refs/notes/commit-to-mail"

	if git -C "$GITGIT_DIR" rev-parse --verify refs/remotes/upstream/seen >/dev/null 2>&1
	then
		# Let's take 'seen' from the official source at git.git.
		git -C "$GITGIT_DIR" remote set-url upstream https://github.com/git/git
		git -C "$GITGIT_DIR" fetch upstream ||
		die "Could not update the 'upstream' remote to $GITGIT_DIR"
	else
		git -C "$GITGIT_DIR" remote add -f upstream https://github.com/git/git ||
		die "Could not add the 'upstream' remote to $GITGIT_DIR"
	fi
}

lookup_tae () {
	# The --notes function writes notes to the commit-to-mail notes ref, and we
	# can make use of that if we *already* spent the effort of identifying
	# the correct Message-Id, we might just as well use it...
	if test -n "$2" && messageid="$(git -C "$GITGIT_DIR" notes --ref=refs/notes/commit-to-mail show "$2" 2>/dev/null | tail -n 1)" && test -n "${messageid#no match}"
	then
		echo "$messageid"
		return 0
	fi

	# We try to match the timestamp first; the author name and author email are
	# not as reliable: they might have been overridden via a "From:" line in the
	# mail's body
	timestamp=${1%% *}

	lines="$(grep "^$timestamp " <"$LORE_GIT_DIR/"tae-list.txt)"
	if test 1 != $(echo "$lines" | wc -l)
	then
		if test -n "$2"
		then
			oneline="$(git -C "$GITGIT_DIR" show -s --format=%s "$2" | sed 's/^\[.*\] //')"
			git -C "$GITGIT_DIR" diff "$2"^! | sed -e '/^index /d' -e 's/^@@ .*/@@/' >"$LORE_GIT_DIR"/.tmp."$2".commit
			linecount=$(wc -l <"$LORE_GIT_DIR"/.tmp."$2".commit)
			for h in $(echo "$lines" | cut -d ' ' -f 2)
			do
				filename="$(git -C "$LORE_GIT_DIR" diff --name-only $h^!)"

				# If the oneline matches, we have a match
				if test "a$oneline" = "a$(git -C "$LORE_GIT_DIR" show $h:$filename | sed -n 's/^Subject: \(\[.*\] \)\(.*\)/\2/p' | head -n 1)"
				then
					rm "$LORE_GIT_DIR"/.tmp."$2".commit
					git -C "$LORE_GIT_DIR" show $h | sed -n 's/^+Message-Id: <\(.*\)>/\1/ip' | head -n 1
					return 0
				fi

				# If the diff is reasonably close enough, we have a match
				git -C "$LORE_GIT_DIR" show $h:$filename | git mailinfo "$LORE_GIT_DIR"/.tmp."$2".msg "$LORE_GIT_DIR"/.tmp."$2".mail >/dev/null
				sed -n '/^diff --git/,${/^index /d;s/^@@ .*/@@/;p}' <"$LORE_GIT_DIR"/.tmp."$2".mail >"$LORE_GIT_DIR"/.tmp."$2".mailpatch
				rm "$LORE_GIT_DIR"/.tmp."$2".msg
				rm "$LORE_GIT_DIR"/.tmp."$2".mail
				diffsize=$(git diff --no-index -U0 "$LORE_GIT_DIR"/.tmp."$2".commit "$LORE_GIT_DIR"/.tmp."$2".mailpatch | wc -l)
				rm "$LORE_GIT_DIR"/.tmp."$2".mailpatch
				if test $diffsize -lt 30 && test $(($diffsize * 100 / $linecount)) -lt 40
				then
					rm "$LORE_GIT_DIR"/.tmp."$2".commit
					git -C "$LORE_GIT_DIR" show $h | sed -n 's/^+Message-Id: <\(.*\)>/\1/ip' | head -n 1
					return 0
				fi
			done
			rm "$LORE_GIT_DIR"/.tmp."$2".commit
		fi

		# Hard-code a couple of manually identified pairings
		case "$2" in
		1f961c196cbb475e612a4fb082b33efde71e7a03) echo 20050920001949.GL18320@pasky.or.cz;;
		c2c07a5c2adf2aebc19b04a608592489b156a8bb) echo E1EXQWT-00050C-Td@localhost.localdomain;;
		e5971d7d138879c071643e4e08fceb4d0ae354ac) echo 11412770173208-git-send-email-ryan@michonline.com;;
		7bedd9fc811df1fd865cebdae016f2f278501cc5) echo 11507842063504-git-send-email-jnareb@gmail.com;;
		4f01748d51b530c297eeb5a0ece9af923d5db937) echo 20070327115427.10016.93595.julian@quantumfyre.co.uk;;
		dca3957b8581ffd0faab135191bbee3029953bd2) echo 465644B2.5040203@gmail.com;;
		3bd62c21760f92996569bb9335b399a9545a5c41) echo 20080814180220.15729.51838.stgit@aristoteles.cuci.nl;;
		*)
			echo "Multiple records found:"

			for h in $(echo "$lines" | cut -d ' ' -f 2)
			do
				git -C "$LORE_GIT_DIR" show -s --format="%nOn %ad, %an <%ae> sent" $h
				git -C "$LORE_GIT_DIR" show $h |
				sed -n -e 's/^+Message-Id: <\(.*\)>/\1/ip' \
					-e 's/^+Subject: //ip'
			done

			return 1
			;;
		esac
		return 0
	fi

	test -n "$lines" || {
		echo "Could not find any mail for timestamp $timestamp"
		return 1
	}

	# We found exactly one record: print the message ID
	h=${lines#$timestamp }
	h=${h%% *}
	messageid="$(git -C "$LORE_GIT_DIR" show $h | sed -n 's/^+Message-Id: <\(.*\)>/\1/ip' | head -n 1)" &&
	test -n "$messageid" &&
	echo "$messageid" || {
		echo "Could not determine Message-Id from $h"
		return 1
	}
}

LF='
'
test notes != "$mode" || {
	delete_lines=
	test update != "$*" || {
		update_gitgit_dir ||
		die "Could not update $GITGIT_DIR"

		to="$(git -C "$GITGIT_DIR" rev-parse --verify refs/remotes/upstream/seen)" ||
		die "Could not determine tip rev of upstream/seen"
		from="$(git -C "$GITGIT_DIR" show -s --format=%s refs/notes/commit-to-mail^{/Update.from.commit.range} 2>/dev/null | sed -ne 's/"//g' -e 's/^Update from commit range \(.*\.\.\)\?//p')"

		# Already the newest? Skip
		test "$to" != "$from" || {
			echo "Already up to date" >&2
			exit 0
		}

		# Set the command-line argument to the correct range
		set -- "${from:+$from..}$to"

		# Remove the commits that are no longer reachable
		test -z "$from" ||
		delete_lines="$(git -C "$GITGIT_DIR" rev-list "$to..$from" | sed 's/^../D &\//')"
	}

	matched="$(git -C "$GITGIT_DIR" diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904..refs/notes/commit-to-mail 2>/dev/null | sed -n '/^++/{s/^+++ b//;s/\///g;N;N;s/\n@@ .*\n+/ /;p}')"

	test "no match" != "$*" ||
	set -- --no-walk $(echo "$matched" | sed -n 's/ no match$//p')

	update_mail_archive_dir ||
	die "Could not update $LORE_GIT_DIR"

	(cat <<-EOH
		commit refs/notes/commit-to-mail
		committer $(git -C "$GITGIT_DIR" var GIT_COMMITTER_IDENT)
		data <<EOF
		Update from commit range "$@"
		EOF
		EOH
	 git -C "$GITGIT_DIR" rev-parse -q --verify refs/notes/commit-to-mail >/dev/null && echo "from refs/notes/commit-to-mail^0"
	 test -z "$delete_lines" || echo "$delete_lines"

	 res=0
	 counter=0
	 git -C "$GITGIT_DIR" log --reverse --no-merges --format="%at %H %an <%ae>" "$@" |
	 while read timestamp commit author
	 do
		counter=$(($counter+1))
		printf 'Counter: %d\r' $counter >&2

		case "$LF$matched" in *"$LF$commit no match"*) ;; *"$LF$commit "*) continue;; esac

		commitpath="${commit#??}"
		commitpath="${commit%$commitpath}/$commitpath"

		if out="$(lookup_tae "$timestamp $author")"
		then
			printf 'M 100644 inline %s\ndata <<EOF\n%s\nEOF\n' "$commitpath" "$out"
			continue
		fi

		# gitk,git-gui patches are often taken via Pull Requests, let's look only at patches from known git.git (interim) maintainers
		case "$(git -C "$GITGIT_DIR" show -s --format=%cn "$commit")" in
		"Linus Torvalds"|"Junio C Hamano"|"Shawn O. Pearce"|"Jeff King"|"Jonathan Nieder"|"Taylor Blau") ;; # these should be mostly on the mailing list
		*) continue;; # these are not expected to have been discussed on the mailing list
		esac

		# Junio often commits directly (more often in the earlier days)
		if test "Junio C Hamano" = "${author% <*>}" || test "Junio Hamano" = "${author% <*>}"
		then
			# skip silently
			continue
		fi

		# Linus committed directly before Junio took over
		if test $timestamp -lt 1122608243 && test "Linus Torvalds" = "${author% <*>}"
		then
			# skip silently
			continue
		fi

		# Security patches, and manually identified pairings
		case "$commit" in
		c2b3af0537e0b2c7624913b0f26191e992beb12c|e174744ad17a55d4df68cec97bfbf6b0c28e762b|b62fb077d5504deadea931fd16075729f39b8f47|4616918013bf4fb3ce61175702d963a1fdd87f84|96b50cc19003d54f5962d65597c94e2c52eb22e7|cc2fc7c2f07c4a2aba5a653137ac9b489e05df43|450870cba7a9bac94b5527021800bd8bf037c99c|76e86fc6e3523d28e8db00e7b10c33c553d996b8|6162a1d323d24fd8cbbb1a6145a91fb849b2568f|a42643aa8d88a2278acad2da6bc702e426476e9b|a18fcc9ff22b714e7df30c400c05542f52830eb0|1d1d69bc52dcc7def5b2edbd165cc0a4e3911c8e|2b4c6efc82119ba8f4169717473d95d1a89e4c69|d08c13b947335cc48ecc1a8453d97b7147c2d6d6|94bc83c5930c8c73fb0106b629123e2413b371af|5248f2dd4fe763ef9d1267f50481deee36ee57c1|b48537305229d1a4f25633f71941ee52d2582017|f514ef9787f320287d7ba71f2965127b9d8b3832|c29edfefb6f6a3fef80172c16bcc34c826d417b0|5015f01c12a45a1042c1aa6b6f7f6b62bfa00ade|3efb988098858bf6b974b1e673a190f9d2965d1d|dcd1742e56ebb944c4ff62346da4548e1e3be675|83c4d380171a2ecd24dd2e04072692ec54a7aaa5|30c586ff15935d4439ab31f9ab8424f28e6b461e|aeeb2d496859419ac1ba1da1162d6f3610f7f1f3|3be4cf09cd3d0747af3ecdb8dc3962a0969b731e|2491f77b90c2e5d47acbe7472c17e7de0af74f63|2d90add5ad216807ec1433e5367fae730e74a4cb|820d7650cc670d3e4195aad3a5343158c316e8fa|fce13af5d20cad8dcb2d0e47bcf01b6960f08e55|27dd73871f814062737c327103ee43f1eb7f30d9|0383bbb9015898cbc79abd7b64316484d7713b44|11a9f4d807a0d71dc6eff51bb87baf4ca2cccf1d|0fc333ba20b43a8afee5023e92cb3384ff4e59a6|e7cb0b4455c85b53aeba40f88ffddcf6d4002498|dc2d9ba3187fcd0ca8eeab9aa9ddef70cf8627a6|41a80924aec0e94309786837b6f954a3b3f19b71|e19e5e66d691bdeeeb5e0ed2ffcecdd7666b0d7b|641084b618ddbe099f0992161988c3e479ae848b|eb12dd0c764d2b71bebd5ffffb7379a3835253ae|10ecfa76491e4923988337b2e2243b05376b40de|db5a58c1bda5b20169b9958af1e8b05ddd178b01|ed9c3220621d634d543bc4dd998d12167dfc57d4|7ac4f3a007e2567f9d2492806186aa063f9a08d6|159e7b080bfa5d34559467cacaa79df89a01afc0|2738744426c161a98c2ec494d41241a4c5eef9ef|ed8b10f631c9a71df3351d46187bf7f3fa4f9b7e|1995b5e03e1cc97116be58cdc0502d4a23547856|6e328d6caef218db320978e3e251009135d87d0e|73c3f0f704a91b6792e0199a3f3ab6e3a1971675|b7b1fca175f1ed7933f361028c631b9ac86d868d)
			# security bug fixes, discussed off list, skip silently
			continue;;
		df126e108b899da133a980e900df39dfe57fcd59) out="20121031115522.GA21011@sigill.intra.peff.net";;
		2e736fd5e94c6fa44ba95d81a5b0ae407b968b78) out="20121031120112.GB21011@sigill.intra.peff.net";;
		3b13af9d6cfab0d66cae386cbdc924030ad7a1e8) continue;; # no trace on the mailing list of this contribution
		5badfdcf8852cf3afe2bde17ec2a11cde8cfc2e9) continue;; # this must have come out of left field; there is no trace of the contributor on the mailing list, could be Junio's alter ego
		a33faf2827bfc7baea5d83ef1be8fe659a963355) out="20121228164322.B102B4413A@snark.thyrsus.com";;
		3b12f46ab382b280effa15a925b6195abaebf0a3) out="50EEAFA1.2030000@dcon.de";;
		8b2d219a3d6db49c8c3c0a5b620af33d6a40a974) out="50EEAFB1.2090604@gmail.com";;
		eae6cf5aa8ae2d8a90a99bbe4aeb01c29e01fd02) out="20130308100152.GA32643@dcvr.yhbt.net";;
		3a51467b94306e77c1b69b374bac33b6672bc177) out="1365743141-2513-2-git-send-email-benoit.bourbie@gmail.com";;
		eafc2dd59f4d28d4a01deb24df588fd7a29990d8) out="7vd2tdn41h.fsf@alter.siamese.dyndns.org";;
		0a2623269ff2996c453667a4abc12fbbbf2194b1|ca35487192c449dc0b22a46af4ec75914a8d4383|fb99070303e8e8af4438c0bad76d459af80d3bba|ce39c2e04ced177747d02de83f61989dcbcca44e|2be50eae75ef1d6c83a0546ebe7309f368b5824f|bbc284d6ecaa1974c142e95272e866287694ca17|65db0443710f59a1c05a85688cdccc215ff48333) continue;; # msysgit PR 87sj0uwh20.fsf@fox.patthoyts.tk
		7412290cc4b5aa0efc205f81e4775dd7df9ea9d5) out="1372091966-19315-3-git-send-email-szeder@ira.uka.de";;
		4fe00b4f0ab148de78db18790955d5e381377b14) out="1372091966-19315-2-git-send-email-szeder@ira.uka.de";;
		c9a102e81ffedde3fed4b88199ea13a3a5ee5f5d) out="1372091966-19315-4-git-send-email-szeder@ira.uka.de";;
		b91b935f04e8dcb1cc9f247627fbd0346ce949f4) out="1372091966-19315-9-git-send-email-szeder@ira.uka.de";;
		511ad159049fc64a13ef3e9565cc9634acb6404b) out="1372091966-19315-8-git-send-email-szeder@ira.uka.de";;
		96ea404757ac3f97335277062a7d7c6e8975cc4f) out="1372091966-19315-7-git-send-email-szeder@ira.uka.de";;
		e8f21caf94287d838cfffe8301b28fdc45480ac8) out="1372091966-19315-6-git-send-email-szeder@ira.uka.de";;
		868dc1acecdb8b661e415c6c5f09db5370b35fa7) out="1372091966-19315-5-git-send-email-szeder@ira.uka.de";;
		efaa0c153297f551a42fd1e21f28f51f4924f316) out="1372091966-19315-11-git-send-email-szeder@ira.uka.de";;
		3a43c4b5bd19528229ef36b28d648d5ac98f15f1) out="1336524290-30023-12-git-send-email-szeder@ira.uka.de";;
		e3e0b9378b6e51ea50c023d92d4d2a1f4d4cc676) out="1372091966-19315-12-git-send-email-szeder@ira.uka.de";;
		a694258457e51f20e92854075914c8d3a4593367) out="1372091966-19315-17-git-send-email-szeder@ira.uka.de";;
		69a8141a5d81925b7e08cb228535e9ea4a7a02e3) out="1371521826-3225-14-git-send-email-szeder@ira.uka.de";;
		14d7649748265fe9fe991439ca6ae0c9db7a27ab) out="1371521826-3225-13-git-send-email-szeder@ira.uka.de";;
		dd0b72cbd9e64c782a31c6acfca2ba9cf2ffb266) out="1371521826-3225-12-git-send-email-szeder@ira.uka.de";;
		0f37c125814afc8ad2fa43fecd8b200216ebfab5) out="1372091966-19315-13-git-send-email-szeder@ira.uka.de";;
		680be044d98b3b703bc33d546a987c19b3779aeb) out="1379401577-36799-5-git-send-email-sunshine@sunshineco.com";;
		02a110ad435a6ccda648f09f94e546dfd7bdd0ac) continue;; # v1.8.4.1, never made it to the list
		680be044d98b3b703bc33d546a987c19b3779aeb) out="1379401577-36799-5-git-send-email-sunshine@sunshineco.com";;
		02a110ad435a6ccda648f09f94e546dfd7bdd0ac) out="alpine.SOC.2.11.1310251814410.29200@dogbert.cc.ndsu.NoDak.edu";;
		568950388be2e47af8bcb0b4a5f02017570b2f33) out="1421927415-114643-1-git-send-email-kirill.shutemov@linux.intel.com";;
		59c222052801a55bb40a78378ea19c6b7c4ec45d) out="20131011174210.GS9464@google.com";;
		339c17bc7690b5436ac61c996cede3d52c85b50d) out="1264126491-8273-2-git-send-email-vonbrand@inf.utfsm.cl";;
		59556548230e617b837343c2c07e357e688e2ca4) out="20131117220719.4386.73779.chriscool@tuxfamily.org";;
		fce135c4ffc87f85e1c3b5c57a6d9e1abdbd074d) out="9ee3e17af9a8da1f47423a74171d5cb95293f677.1391430523.git.kirr@mns.spb.ru";;
		76e7c8a7ed58250bb74cf55618a81baed1797eca) out="20140428153527.GB12357@camelia.ucw.cz";;
		4950eed520ce3dbb786e33fe8a8dc48e492998b4) out="20140909063825.GA6545@dcvr.yhbt.net";;
		30d45f798d1a4b14759cd977b68be4476d66ea17) out="1410681849-3107-1-git-send-email-normalperson@yhbt.net";;
		d0b34f241dc59fe2352cb1a724d0c5e8f0d2ff82|54b95346c1322bb122e12aba0f03652f241a918b) continue;; # git-svn PR
		2b6c613f1a873555475050bd8f5a22828f0d03a3) out="20141021090055.GA22184@dcvr.yhbt.net";;
		6725ecaba7af16c69591e5a180acbc521e2bba63) out="1414224094-32499-1-git-send-email-normalperson@yhbt.net";;
		aee7d04c126b48a9871309ec65cecf88781b1d32) out="1414224055-10184-1-git-send-email-normalperson@yhbt.net";;
		7676aff70973e617c3f58a8633db6d0e3ee99e45) out="20141027014033.GA4189@dcvr.yhbt.net";;
		4ae9a7b966e61d25605b575163964f8375e37c9a) out="1414658206-12629-1-git-send-email-normalperson@yhbt.net";;
		da0bc948ac2e01652a150fd4a57cebad6143242c) out="1414658206-12629-2-git-send-email-normalperson@yhbt.net";;
		c4f901d1593f3ef097c3e73daa2847ed9ad9efe0) out="5463DA20.3080703@inventati.org";;
		47092c10671da906ae626634dc83beb29ce76a9d) out="20150115101434.GA15361@dcvr.yhbt.net";;
		85cb8906f0e9b5639230fe247d5d916db8806777) out="20150415093418.GH23475@mewburn.net";;
		ad4cd6c29743274001cce323b670f7fb0c035ff1) out="1431225937-10456-5-git-send-email-mhagger@alum.mit.edu";;
		ba43b7f29c59f75cf5f28af3a02d16c08937e439) out="1431225937-10456-6-git-send-email-mhagger@alum.mit.edu";;
		61e51e0000073b684eaf5393ae2229f4f62f35c9) out="1431225937-10456-7-git-send-email-mhagger@alum.mit.edu";;
		6e30b2f652d0a6748e2041dee5b5612cafca29b2) out="6097b21b368baaacdd887deb086219cb919e00d9.1462550456.git.mhagger@alum.mit.edu";;
		78f23bdf68dae56d644892990484951583a64014) continue;; # patch never made it to the list, it seems
		83c4d380171a2ecd24dd2e04072692ec54a7aaa5) out="xmqqlh84lxkx.fsf@gitster.mtv.corp.google.com";;
		b2a7123b997f950e9785a5e7df64c3104270fef3) out="CAOYw7dubGJ=m5+EnjGy7jTQxR+b0uBmyG138KEQ5rzX2K7WcgA@mail.gmail.com";;
		7bd9bcf372d4c03bb7034346d72ae1318e2d0742) out="cover.1447085798.git.mhagger@alum.mit.edu";;
		7f4d4746c14f928b7b6cdc2d21e4bbb2a770187f) out="20180520184009.976-18-pclouds@gmail.com";;
		3df0d26ca6664a20364a323ffe9915459901cf05) out="1456109711-26866-2-git-send-email-normalperson@yhbt.net";;
		62335bbbc747c96636b5ce9917b156304c732eaf) out="20160114040759.GA7671@dcvr.yhbt.net";;
		7cc13c717b52d3539e76f087d747f96d0d24a914) out="1459817917-32078-2-git-send-email-gitster@pobox.com";;
		19dd7d06e5d2c58895dd101025c013404025e192) out="19dd7d06e5d2c58895dd101025c013404025e192.1462550456.git.mhagger@alum.mit.edu";;
		5387c0d8839e366c44838c808ccc20eb7f9bd358) out="5387c0d8839e366c44838c808ccc20eb7f9bd358.1462550456.git.mhagger@alum.mit.edu";;
		e167a5673e25b960dce118fb967d54da30b69def) out="e167a5673e25b960dce118fb967d54da30b69def.1462550456.git.mhagger@alum.mit.edu";;
		e95792e532bde75fd4a1e91aecfcf9a28ba23955) out="e95792e532bde75fd4a1e91aecfcf9a28ba23955.1462550456.git.mhagger@alum.mit.edu";;
		728af2832c3e58222965521682414adb9a80932b) out="728af2832c3e58222965521682414adb9a80932b.1462550456.git.mhagger@alum.mit.edu";;
		39950fef8bb45e944655e48393ee04c0b33211f5) out="b1ad00ad0962210fe1746012640312b40b22fa99.1461768689.git.mhagger@alum.mit.edu";;
		35db25c65f6f77c153ef2b1183ea7821236201c8) out="51574acf932c4650110d9f7be0601532879f624c.1461768689.git.mhagger@alum.mit.edu";;
		e40f3557f7e767bd2be2a824bc3bc2379aa69931) out="a8e1e1a9e6a48fbb20fab2144279b93a48db584a.1461768689.git.mhagger@alum.mit.edu";;
		76fc394d50efef8f1308a0f0d56087f502dac689) out="76fc394d50efef8f1308a0f0d56087f502dac689.1462550456.git.mhagger@alum.mit.edu";;
		e711b1af2ead2ffad5c510aadbbc387c7d8aa4c7) out="e711b1af2ead2ffad5c510aadbbc387c7d8aa4c7.1462550456.git.mhagger@alum.mit.edu";;
		2bb051861731a0d8d2a79d0b36857d877f18e476) out="xmqq37pruklb.fsf@gitster.mtv.corp.google.com";;
		f1f2b45be0a2b205fc07758e0f4e9c13e90d34d9) out="4a15c4e6c35cfb425da568d87e8b20b984e5325c.1462774709.git.johannes.schindelin@gmx.de";;
		efe472813d60befd72d6e2797934c90b22a26c93) out="366668e3785a18ca82587ab018ea72eb597e87ba.1462550456.git.mhagger@alum.mit.edu";;
		3a0b6b9aba844075e802a6dc4c24622b34ab535b) out="01fdd8bc94d4d207f7043c138809163ad56ea2e4.1462550456.git.mhagger@alum.mit.edu";;
		fa96ea1b883bf83fc488f999c58396bbab1860c1) out="4de20012b2428116751facc0897a3d3b3a2541e8.1462550456.git.mhagger@alum.mit.edu";;
		92b380931ee8beacb0c09635432b38a02b9fcc7e) out="a81d595d8d327a37a98cffcdf5dc798969cfd39f.1462550456.git.mhagger@alum.mit.edu";;
		bb462b00286902f6cdbb66bb418c59b5c7894e0d) out="3531b94aa4ba673eafdb92ec43838fbf4e619bc2.1462550456.git.mhagger@alum.mit.edu";;
		cf596442c6a18268f3f0d95cf7615a613102746f) out="1443ddf162783043699ba2bc5c9cb0995b9b08cd.1462550456.git.mhagger@alum.mit.edu";;
		bcb497d0f83f9c3e60f00fd2cc87130923329ed9) out="3484a284a7e2d495bff9179aef5ecf29d309e8c1.1462550456.git.mhagger@alum.mit.edu";;
		0568c8e9dce2aa0dd18f41f23e3465f3639e371e) out="48602160ce11b6173c01769cac142a47b7f364b4.1461768689.git.mhagger@alum.mit.edu";;
		c52ce248d63a185eb0a616b361d1fd72c5c66451) out="e053eafabefce5e91ef00fa69f0ff33270507de2.1462550456.git.mhagger@alum.mit.edu";;
		5a563d4ad17a66aabeacfd0f221ac45c07bc4ee8) out="f5bb5bf956f86d78f321b49ff444469bf274bc4c.1462550456.git.mhagger@alum.mit.edu";;
		8bb0455367a17bd7428e02f835e3f55c8cd168da) out="8a4c0c705a4694e54399580eb1abe8a61c556d7d.1462550456.git.mhagger@alum.mit.edu";;
		3a8af7be8f977cbf393dc77884a9ee6dfd611d95) out="b2d414be0f99be4a0f9d7325eb43a1eb85dd7fa9.1462550456.git.mhagger@alum.mit.edu";;
		71564516deccafba0a58129bd7d3851e28fdb4bb) out="64ba0ef8de63267f9625ce8303804a0814d1ecc6.1462550456.git.mhagger@alum.mit.edu";;
		165056b2fc065e27e4077a11ed2bf1589207b997) out="bfba3b42460c75064ce0538cbd6ad820a7ddc537.1462550456.git.mhagger@alum.mit.edu";;
		8415d24746b97a479fe5aec9845bfc150cda2d14) out="e76e0d4119aba05bfce6b4c4d0fe8d7f9d05c132.1462550456.git.mhagger@alum.mit.edu";;
		8a679de6f1a4bd077f828273f75eea46947b5b73) out="a67a1b745d0a14111c774f13a5776d3756cbf2f2.1461768690.git.mhagger@alum.mit.edu";;
		92b1551b1d407065f961ffd1d972481063a0edcc) out="xmqqoa8xia1j.fsf@gitster.mtv.corp.google.com";;
		8169d0d06ad721aa54d95f044f4b097d79151ea2) out="bb0e9b5dd81738f584d3e0b11907345721b0ed2e.1462550456.git.mhagger@alum.mit.edu";;
		5d9b2de4ef5a6b0cc38bbb3affcc614a66c663d7) out="678e70dd4fa33223bb5a870d7196413dbfad2c3e.1462550456.git.mhagger@alum.mit.edu";;
		7a418f3a17b95746eb94cfd55f4fe0385d058777) out="1b71052522155c73624dde29ddf1d613b56ff5fa.1462550456.git.mhagger@alum.mit.edu";;
		1354c9b2ded11a2bc24e04b98268a5969b44c666) out="1354c9b2ded11a2bc24e04b98268a5969b44c666.1466222921.git.mhagger@alum.mit.edu";;
		bf0c6603ff809b035bd3b2049597e2273e9d86ed) out="13a5d2e8b84bebaa6d826dd5b7cb78be057874c4.1465299118.git.mhagger@alum.mit.edu";;
		0e4b63b5a8b8d369720f0671040113e347221042) out="cd193d74753c0c5e34995dc5c1df1e8881ba5bcb.1465544913.git.mhagger@alum.mit.edu";;
		017f7221abe6129a41c6a7d2b4ce990f477be74f) out="8d628cac9086238c1507c08838963a7900a1cd32.1465544913.git.mhagger@alum.mit.edu";;
		c5119dcf493a7b13b6a3e586e8d771a9e1d4975e) out="9077546cf7c0fd3968f4cca34e75b92e395f88e1.1465299118.git.mhagger@alum.mit.edu";;
		e3f510393c9d373f2969badc2b8afe179803a0fa) out="4976e72fb492d5cfd2999a1fda4bc28f4ab92ae1.1465299118.git.mhagger@alum.mit.edu";;
		841caad903f2b160e9f5ff05f961d20ad9085ddc) out="dd34c6a5ef249f4ffb8c8cb7238889e84e19f82c.1465299118.git.mhagger@alum.mit.edu";;
		08aade7080ef7955eb356c6590187be3b55dcbcd) out="alpine.DEB.2.20.1607011449380.12947@virtualbox";;
		cec9264f17f5cb4a1bc0f41d51c7f62c6bf4784e) out="20160719100927.GA19702@whir";;
		c0071ae5dc1c610ab3791ece7ccf7d4772fde151) out="20160722204610.GA20896@whir";;
		b624a3e67f498cb41f704c9bd28e7d53076611c8) out="alpine.LFD.2.20.1608161309350.14878@i7";;
		13b5af22f39f5e7d952a4c98ffb7ea25053800c1) continue;; # patch was too large, was pulled
		b26098fc2f76131f4258d800e0892e87f9138331) out="20161014014623.15223-2-e@80x24.org";;
		112423eb905cf28c9445781a7647ba590d597ab3) out="20161014014623.15223-3-e@80x24.org";;
		37a95862c625e1d2ed2609e01b03950253ad4ff9) out="20161108053333.jta7bmqsyvy2ijoh@sigill.intra.peff.net";;
		a0f5a0c8285395d6eb2123e0c1ce78f900e1567c) out="20161212110914.GA24736@starla";;
		22af6fef9b6538c9e87e147a920be9509acf1ddd) out="20161223014202.GA8327@starla";;
		3c0cb0cbaef699f699b79c8be716086053760ea9) out="024d6b2e5ca1ffa876c2911e6d9d0bb4f6091730.1486629195.git.mhagger@alum.mit.edu";;
		f5f5e7f06c210e833632c8f4cb907d0af581f473) continue;; # patch was too large, was pulled
		382fb07f7bbb1f94fa3e1293d5df151725a886a3) out="20170526033510.1793-9-gitster@pobox.com";;
		f7566f073fccafdd9e0ace514b25897dd55d217a) out="20170526033510.1793-11-gitster@pobox.com";;
		614a718a797e04fb037b25371896f910e464b671) out="583ff3fa-425c-6eb9-ddcb-8b0049d422ea@gmail.com";;
		411ddf9eca67f77d09ce72a832332af9b9330569) out="1508399608.4529.10.camel@xwing.info";;
		7513595a3b997e07ad525b213b83e4f0bd358bb9) out="20171121233813.GP3429@aiede.mtv.corp.google.com";;
		95450bbbaaacaf2d603a4fbded25d55243dfb291) out="20171214002050.GA32734@whir";;
		1bba00130a1a0332ec0ad2f878a09ca9b2b18ee2) out="CACx-yZ1DGz2z6qqAX=pzeExT689y0sON+wVDaocdWk75a5SOxA@mail.gmail.com";;
		7f6f75e97acd25f8e95ce431e16d2e1c2093845d) out="20180129231653.GA22834@starla";;
		*) out="no match";;
		esac

		printf 'M 100644 inline %s\ndata <<EOF\n%s\nEOF\n' "$commitpath" "$out"
	 done) |
	git -C "$GITGIT_DIR" fast-import

	return
}

get_commit_tae () {
	commit="$1"
	git -C "$GITGIT_DIR" show -s --format='%at %an <%ae>' "$1" || {
		echo "Could not get Timestamp/Author/Email triplet from $1" >&2
		return 1
	}
}

tae="$(get_commit_tae "$1")"

test reply != $mode ||
test -d "$HOME/Mail" ||
die "Need $HOME/Mail to reply"

update_mail_archive_dir ||
die "Could not update $LORE_GIT_DIR"

messageid="$(lookup_tae "$tae" "$1")" ||
die "Failed to identify Message-Id for $1: $messageid"

case $mode in
print) echo $messageid;;
open)
	url=$mail_remote/$messageid
	case "$(uname -s)" in
	Linux) xdg-open "$url";;
	MINGW*|MSYS*) start "$url";;
	*) die "Need to learn how to open URLs on $(uname -s)";;
	esac
	;;
reply)
	mkdir -p "$HOME/Mail/from-lore.kernel/new" &&
	mkdir -p "$HOME/Mail/from-lore.kernel/cur" &&
	mkdir -p "$HOME/Mail/from-lore.kernel/tmp" ||
	die "Could not set up mail folder 'from-lore.kernel'"

	path=$(git -C "$GITGIT_DIR" diff --name-only $h^!) &&
	mail="$(printf "%s_%09d.%s:2," $(date +%s.%N) $$ $(hostname -f))" &&
	git -C "$GITGIT_DIR" show $h:$path >"$HOME/Mail/from-lore.kernel/new/$mail" ||
	die "Could not write mail"
	;;
*)
	die "Unhandled mode: $mode"
	;;
esac

