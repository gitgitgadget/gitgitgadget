import { gitConfig, git, gitConfigForEach } from "./git";
import { sep } from "path";

// For now, only the Git, Cygwin and BusyBox projects are supported
export class ProjectOptions {
    readonly branchName: string;
    readonly upstreamBranch: string;
    readonly basedOn: string;
    readonly publishToRemote: string;

    readonly to: string;
    readonly cc: string[];
    readonly midUrlPrefix: string;

    protected constructor(branchName: string, upstreamBranch: string, basedOn: string, publishToRemote: string, to: string, cc: string[], midUrlPrefix: string) {
        this.branchName = branchName;
        this.upstreamBranch = upstreamBranch;
        this.basedOn = basedOn;
        this.publishToRemote = publishToRemote;

        this.to = to;
        this.cc = cc;
        this.midUrlPrefix = midUrlPrefix;
    }

    static async getBranchName(): Promise<string> {
        // Get the current branch name
        let ref = await git(['rev-parse', '--symbolic-full-name', 'HEAD']);
        let match = ref.match(/^refs\/heads\/(.*)/);
        if (!match)
            throw new Error('Not on a branch (' + ref + ')?');
        return match![1];
    }

    static async get(): Promise<ProjectOptions> {
        let branchName: string = await this.getBranchName();
        let upstreamBranch: string;
        let to: string, cc: string[] = await this.getCc(branchName);
        let midUrlPrefix: string = ' Message-ID: ';

        if (this.commitExists('e83c5163316f89bfbde')) {
            // Git
            to = '--to=git@vger.kernel.org';
            cc.push('Junio C Hamano <gitster@pobox.com>');
            upstreamBranch = 'upstream/pu';
            if (await git(['rev-list', branchName + '..' + upstreamBranch]))
                upstreamBranch = 'upstream/next';
            if (await git(['rev-list', branchName + '..' + upstreamBranch]))
                upstreamBranch = 'upstream/master';
            midUrlPrefix = 'https://public-inbox.org/git/';
        } else if (this.commitExists('a3acbf46947e52ff596')) {
            // Cygwin
            to = '--to=cygwin-patches@cygwin.com';
            upstreamBranch = 'cygwin/master';
            midUrlPrefix = 'https://www.mail-archive.com/search?l=cygwin-patches@cygwin.com&q=';
        } else if (this.commitExists('cc8ed39b240180b5881')) {
            // BusyBox
            to = '--to=busybox@busybox.net';
            upstreamBranch = 'busybox/master';
            midUrlPrefix = 'https://www.mail-archive.com/search?l=busybox@busybox.net&q=';
        } else
            throw new Error('Unrecognized project');

        let publishToRemote = await gitConfig('mail.publishtoremote');
        let basedOn: string = await this.determineBaseBranch(branchName, publishToRemote);

        if (basedOn)
            upstreamBranch = basedOn;

        if (await git(['rev-list', branchName + '..' + upstreamBranch]))
            throw new Error('Branch ' + branchName + ' is not rebased to ' + upstreamBranch);

        return new ProjectOptions(branchName, upstreamBranch, basedOn, publishToRemote, to, cc, midUrlPrefix);
    };

    protected static async commitExists(commit: string): Promise<boolean> {
        try {
            await git(['rev-parse', '--verify', commit]);
            return true;
        } catch (err) {
            return false;
        }
    }

    protected static async determineBaseBranch(branchName: string, publishToRemote: string): Promise<string> {
        let basedOn = await gitConfig('branch.' + branchName + '.basedon');
        if (basedOn && !await this.commitExists(basedOn))
            throw new Error('Base branch does not exist: ' + basedOn);

        if (!publishToRemote)
            throw new Error('Need a remote to publish to');

        let remoteRef = 'refs/remotes/' + publishToRemote + '/' + basedOn;
        if (!await this.commitExists(remoteRef))
            throw new Error(basedOn + ' not pushed to ' + publishToRemote);

        let commit = await git(['rev-parse', '-q', '--verify', remoteRef]);
        if (await git(['rev-parse', basedOn]) != commit)
            throw new Error(basedOn + ' on ' + publishToRemote +
                ' disagrees with local branch');

        return basedOn;
    }

    protected static async getCc(branchName: string): Promise<string[]> {
        // Cc: from config
        let cc: string[] = [];
        await gitConfigForEach('branch.' + branchName + '.cc',
            email => {
                if (email)
                    cc.push(email);
            });
        return cc;
    }
}

export class PatchSeriesOptions {
    redo?: boolean;
    dryRun?: boolean;
    rfc?: boolean;
    patience?: boolean;
}

export class PatchSeries {
    readonly options: PatchSeriesOptions;
    readonly project: ProjectOptions;

    readonly iteration: number;
    readonly subjectPrefix: string;
    readonly branchDiff: string;
    readonly inReplyTo: string[];

    protected constructor(options: PatchSeriesOptions, project: ProjectOptions, iteration: number, subjectPrefix: string, branchDiff: string, inReplyTo: string[]) {
        this.options = options;
        this.project = project;

        this.iteration = iteration;
        this.subjectPrefix = subjectPrefix;
        this.branchDiff = branchDiff;
        this.inReplyTo = inReplyTo;
    }

    static async get(options: PatchSeriesOptions, project: ProjectOptions): Promise<PatchSeries> {
        let latestTag: string = await this.getLatestTag(project.branchName, options.redo);

        let iteration: number, subjectPrefix: string, branchDiff: string, inReplyTo: string[] = [];
        if (!latestTag) {
            iteration = 1;
            subjectPrefix = options.rfc ? 'PATCH/RFC' : '';
            branchDiff = '';
        } else {
            let range = latestTag + '...' + project.branchName;
            if (! await git(['rev-list', range]))
                throw new Error('Branch ' + project.branchName + ' was already submitted: ' + latestTag);

            let match = latestTag.match(/-v([1-9][0-9]*)$/);
            iteration = parseInt(match && match[1] || '0') + 1;
            subjectPrefix = 'PATCH' + (options.rfc ? '/RFC' : '') + ' v' + iteration;

            let tagMessage = await git(['cat-file', 'tag', latestTag]);
            match = tagMessage.match(/^[\s\S]*?\n\n([\s\S]*)/);
            (match ? match[1] : tagMessage).split('\n').map(function (line) {
                match = line.match(/https:\/\/public-inbox\.org\/.*\/([^\/]+)/);
                if (!match)
                    match = line.match(/https:\/\/www\.mail-archive\.com\/.*\/([^\/]+)/);
                if (!match)
                    match = line.match(/http:\/\/mid.gmane.org\/(.*)/);
                if (!match)
                    match = line.match(/^[^ :]*: Message-ID: ([^\/]+)/);
                if (match)
                    inReplyTo.unshift(match[1]);
            });

            branchDiff = await git(['tbdiff', '--no-color', range]);
        }

        if (options.dryRun)
            console.log('Dry-run ' + project.branchName + ' v' + iteration);
        else
            console.log('Submitting ' + project.branchName + ' v' + iteration);

        return new PatchSeries(options, project, iteration, subjectPrefix, branchDiff, inReplyTo);
    };

    async generateAndSend(): Promise<void> {
        console.log('Generating mbox');
        let mbox = await this.generateMBox();
        let mails: string[] = PatchSeries.splitMails(mbox);

        let ident = await git(['var', 'GIT_AUTHOR_IDENT']);
        let match = ident.match(/.*>/);
        let thisAuthor = match && match[0];
        if (!thisAuthor)
            throw new Error('Could not determine author ident from ' + ident);

        console.log('Adding Cc: and explicit From: lines for other authors, if needed');
        await PatchSeries.insertCcAndFromLines(mails, thisAuthor);
        if (mails.length > 1) {
            console.log('Fixing Subject: line of the cover letter');
            mails[0] = await PatchSeries.adjustCoverLetter(mails[0]);
        }

        console.log("Generating tag message");
        let tagMessage = await PatchSeries.generateTagMessage(mails[0], mails.length > 1, this.project.midUrlPrefix, this.inReplyTo);
        let url = await gitConfig('remote.' + this.project.publishToRemote + '.url');
        let tagName = this.project.branchName + '-v' + this.iteration;

        console.log('Inserting links');
        tagMessage = await PatchSeries.insertLinks(tagMessage, url, tagName, this.project.basedOn);

        if (this.options.dryRun)
            console.log('Would generate tag ' + tagName
                + ' with message:\n\n'
                + tagMessage.split('\n').map(line => {
                    return '    ' + line;
                }).join('\n'));
        else {
            console.log('Generating tag object');
            await this.generateTagObject(tagName, tagMessage);
        }

        console.log('Inserting branch-diff');
        if (this.branchDiff)
            mails[0] = PatchSeries.insertBranchDiff(mails[0], mails.length > 1,
                 `Branch-diff vs v${this.iteration - 1}:`, this.branchDiff);

        if (this.options.dryRun)
            console.log("Would send this mbox:\n\n"
                + mbox.split('\n').map(line => {
                    return '    ' + line;
                }).join('\n'));
        else {
            console.log('Calling the `send-mbox` alias');
            await this.sendMBox(mails.join('\n'));
        }

        console.log('Publishing branch and tag');
        await this.publishBranch(tagName);
    }

    protected static async getLatestTag(branchName: string, redo?: boolean): Promise<string> {
        let args: string[] = [
            'for-each-ref', '--format=%(refname)', '--sort=-taggerdate', 'refs/tags/' + branchName + '-v*[0-9]'
        ];
        let latesttags: string[] = (await git(args)).split('\n');
        let latesttag: string;

        if (redo)
            return latesttags.length > 1 ? latesttags[1] : '';
        return latesttags.length > 0 ? latesttags[0] : '';
    };

    protected async generateMBox(): Promise<string> {
        // Auto-detect whether we need a cover letter
        let coverLetter = await gitConfig('branch.' + this.project.branchName + '.description');

        let commitRange = this.project.upstreamBranch + '..' + this.project.branchName;
        if (!coverLetter && 1 < parseInt(await git(['rev-list', '--count', commitRange])))
            throw new Error('Branch ' + this.project.branchName + ' needs a description');

        let args = ['format-patch', '--thread', '--stdout',
            '--add-header=Fcc: Sent',
            '--add-header=Content-Type: text/plain; charset=UTF-8',
            '--add-header=Content-Transfer-Encoding: 8bit',
            '--add-header=MIME-Version: 1.0',
            '--base', this.project.upstreamBranch, this.project.to];
        this.project.cc.map(email => { args.push('--cc=' + email); });
        this.inReplyTo.map(email => { args.push('--in-reply-to=' + email); });
        if (this.subjectPrefix)
            args.push('--subject-prefix=' + this.subjectPrefix);
        if (coverLetter)
            args.push('--cover-letter');
        if (this.options.patience)
            args.push('--patience');

        args.push(commitRange);

        return await git(args);
    };

    protected static splitMails(mbox: string): string[] {
        const separatorRegex = /\n(?=From [0-9a-f]{40} Mon Sep 17 00:00:00 2001\n)/;
        return mbox.split(separatorRegex);
    }

    protected static insertCcAndFromLines(mails: string[], thisAuthor: string): void {
        mails.map((mail, i) => {
            let match = mail.match(/^([^]*?)(\n\n[^]*)$/);
            if (!match)
                throw new Error('No header found in mail #' + i + ':\n' + mail);
            let header = match[1];

            let authorMatch = header.match(/^([^]*\nFrom: )(.*?)(\n(?! )[^]*)$/);
            if (!authorMatch)
                throw new Error('No From: line found in header:\n\n' + header);
            if (authorMatch[2] === thisAuthor)
                return;

            header = authorMatch[1] + thisAuthor + authorMatch[3];
            let ccMatch = header.match(/^([^]*\nCc: .*?)(\n(?! )[^]*)$/);
            if (ccMatch)
                header = ccMatch[1] + ', ' + authorMatch[2] + ccMatch[2];
            else
                header += '\nCc: ' + authorMatch[2];

            mails[i] = header + '\n\nFrom: ' + authorMatch[2] + match[2];
        });
    }

    protected static adjustCoverLetter(coverLetter: string): string {
        const regex =
            /^([^]*?\nSubject: .* )\*\*\* SUBJECT HERE \*\*\*(?=\n)([^]*?\n\n)\*\*\* BLURB HERE \*\*\*\n\n([^]*?)\n\n([^]*)$/;
        let match = coverLetter.match(regex);
        if (!match)
            throw new Error('Could not parse cover letter:\n\n' + coverLetter);

        let subject = match[3].split(/\n(?=.)/).join('\n ');
        return match[1] + subject + match[2] + match[4];
    }

    protected static generateTagMessage(mail: string, isCoverLetter: boolean, midUrlPrefix: string, inReplyTo: string[]): string {
        let regex = isCoverLetter ?
            /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*-- \n/ :
            /\nSubject: (\[.*?\] )?([^]*?(?=\n[^ ]))[^]*?\n\n([^]*?)\n*---\n/;
        let match = mail.match(regex);
        if (!match)
            throw new Error('Could not generate tag message from mail:\n\n' + mail);

        let messageID = mail.match(/\nMessage-ID: <(.*?)>\n/i);
        let footer: string = messageID ? 'Submitted-As: ' + midUrlPrefix + messageID[1] : '';
        inReplyTo.map((id: string) => {
            footer += '\nIn-Reply-To: ' + midUrlPrefix + id;
        });

        // Subjects can contain continuation lines; simply strip out the new
        // line and keep only the space
        return match[2].replace(/\n */g, ' ') + '\n\n' + match[3] + (footer ? '\n\n' + footer : '');
    }

    static insertLinks(tagMessage: string, url: string, tagName: string, basedOn: string): string {
        if (!url)
            return tagMessage;

        let match = url.match(/^https?(:\/\/github\.com\/.*)/);
        if (match)
            url = 'https' + match[1];
        else if (match = url.match(/^(git@)?github\.com(:.*)/))
            url = 'https://github.com/' + match[1];
        else
            return tagMessage;

        let insert =
            'Published-As: ' + url + '/releases/tag/' + tagName + '\n' +
            'Fetch-It-Via: git fetch ' + url + ' ' + tagName + '\n';

        if (basedOn)
            insert =
                'Based-On: ' + basedOn + ' at ' + url + '\n' +
                'Fetch-Base-Via: git fetch ' + url + ' ' + basedOn + '\n' +
                insert;

        if (!tagMessage.match(/\n[-A-Za-z]+: [^\n]*\n$/))
            insert = '\n' + insert;
        return tagMessage + insert;
    }

    async generateTagObject(tagName: string, tagMessage: string): Promise<void> {
        let args = ['tag', '-F', '-', '-a'];
        !this.options.redo || args.push('-f');
        args.push(tagName);
        await git(args, { stdin: tagMessage });
    }

    static insertBranchDiff(mail: string, isCoverLetter: boolean, branchDiffHeader:string, branchDiff: string): string {
        if (!branchDiff)
            return mail;

        let regex = isCoverLetter ?
            /^([^]*?\n-- \n)([^]*)$/ : /^([^]*?\n---\n(?:\n[A-Za-z:]+ [^]*?\n\n)?)([^]*)$/;
        let match = mail.match(regex);
        if (!match)
            throw new Error('Failed to find branch-diff insertion point for\n\n' + mail);

        // split the branch-diff and prefix with a space
        return match[1] + '\n' + (branchDiffHeader ? branchDiffHeader + '\n' : '')
            + branchDiff.replace(/(^|\n(?!$))/g, '$1 ') + '\n' + match[2];
    }

    async sendMBox(mbox: string): Promise<void> {
        await git(['send-mbox'], { stdin: mbox });
    }

    async publishBranch(tagName: string): Promise<void> {
        if (!this.project.publishToRemote || this.options.dryRun)
            return;

        if (this.options.redo)
            tagName = '+' + tagName;
        await git(['push', this.project.publishToRemote, '+' + this.project.branchName, tagName]);
    }
}