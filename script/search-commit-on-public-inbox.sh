#!/bin/sh

for c in "$@"
do
	m="$(curl -s https://public-inbox.org/git/?q="$(git show --format=%aI\ %s -s $c |
		sed -e 's/^\(....\)-\(..\)-\(..\)[^ ]* \(.*\)/d%3A\1\2\3..\1\2\3+s%3A%22\4%22/' -e 'y/ /+/')" |
		grep -v '\[PATCH 0*/' |
		sed -n '/Search results/,/^Archives are clon/s/^href="\([^"?][^"]*\)\/">\([^<]*\).*/\1 \2/p')"

	test -n "$m" ||
	m="$(curl -s https://public-inbox.org/git/?q="$(git show --format=%aI\ %s -s $c |
		sed -e 's/^[^ ]* \(.*\)/s%3A%22\1%22/' -e 'y/ /+/')" |
		grep -v '\[PATCH 0*/' |
		sed -n '/Search results/,/^Archives are clon/s/^href="\([^"?][^"]*\)\/">\([^<]*\).*/\1 \2/p')"

	test -n "$m" ||
	m="$(curl -s https://public-inbox.org/git/?q="$(git show --format=%aI\ %s -s $c |
		sed -e 's/^\(....\)-\(..\)-\(..\)[^ ]* \(.*\)/d%3A\1\2\3..\1\2\3+\4/' -e 'y/ /+/')" |
		grep -v '\[PATCH 0*/' |
		sed -n '/Search results/,/^Archives are clon/s/^href="\([^"?][^"]*\)\/">\([^<]*\).*/\1 \2/p')"

	test -n "$m" ||
	m="$(curl -s https://public-inbox.org/git/?q="$(git show --format=%aI\ %s -s $c |
		sed -e 's/^[^ ]* //' -e 'y/ /+/')" |
		grep -v '\[PATCH 0*/' |
		sed -n '/Search results/,/^Archives are clon/s/^href="\([^"?][^"]*\)\/">\([^<]*\).*/\1 \2/p')"

	test -n "$m" || {
		echo "No candidate for $c"
		continue
	}

	m2="$(echo "$m" | grep '^[^ ]* \[PATCH \(v[0-9]* \)\?[1-9]')"
	test -z "$m2" || {
		m="$m2"
		test 1 = $(echo "$m" | wc -l) || {
			v="$(echo "$m" | sed -n 's/^[^ ]* \[PATCH v\([0-9]*\) .*/\1/p' | sort -n -r | head -n 1)"
			test -z "$v" ||
			m="$(echo "$m" | grep "\\[PATCH v$v ")"
		}
	}

	test 1 != $(echo "$m" | wc -l) || {
		printf '\t\t%s) echo %s; continue;;\n' "$c" "${m%% *}"
		continue
	}

	m2="$(echo "$m" | grep -v Re:)"
	if test -n "$m2" && test 1 = $(echo "$m2" | wc -l)
	then
		printf '\t\t%s) echo %s; continue;;\n' "$c" "${m2%% *}"
	else
		echo "Multiple candidates for $c ($(git show -s --format=%an:\ %s $c)):"
		echo "$m" | sed 's|^|https://public-inbox.org/git/|'
	fi
done
