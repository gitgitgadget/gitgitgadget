# Welcome to [GitGitGadget](https://gitgitgadget.github.io/)

Hi @${username}, and welcome to GitGitGadget, the GitHub App to send patch series to the Git mailing list from GitHub Pull Requests.

Please make sure that this Pull Request has a good description, as it will be used as cover letter.

Also, it is a good idea to review the commit messages one last time, as the Git project expects them in a quite specific form:

* the lines should not exceed 76 columns,
* the first line should be like a header and typically start with a prefix like "tests:" or "commit:", and
* the commit messages' body should be describing the "why?" of the change.
* Finally, the commit messages should end in a [Signed-off-by:](https://git-scm.com/docs/SubmittingPatches#dco) line matching the commits' author.

It is in general a good idea to await the automated test ("Checks") in this Pull Request before contributing the patches, e.g. to avoid trivial issues such as unportable code.

## Contributing the patches

Before you can contribute the patches, your GitHub username needs to be added to the list of permitted users. Any already-permitted user can do that, by adding a PR comment of the form `/allow <username>`.

Once on the list of permitted usernames, you can contribute the patches to the Git mailing list by adding a PR comment `/submit`.

After you submit, GitGitGadget will respond with another comment that contains the link to the cover letter mail in the Git mailing list archive. Please make sure to monitor the discussion in that thread and to address comments and suggestions.

If you do not want to subscribe to the Git mailing list just to be able to respond to a mail, you can download the mbox ("raw") file corresponding to the mail you want to reply to from the Git mailing list. If you use GMail, you can upload that raw mbox file via:

```sh
curl -g --user "<EMailAddress>:<Password>" --url "imaps://imap.gmail.com/INBOX" -T /path/to/raw.txt
```
