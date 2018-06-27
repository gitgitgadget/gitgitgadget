const commands = require('probot-commands');
const GitGitGadget = require('./build/lib/gitgitgadget').GitGitGadget;

module.exports = (robot) => {
  let gitGitGadget;

  robot.log('Yay, the app was loaded!');

  const instantiate = async () => {
    if (!gitGitGadget) {
      console.log('Getting new GitGitGadget instance');
      gitGitGadget = await GitGitGadget.get(__dirname);
    }
  }

  const addComment = async (context, comment) => {
    await context.github.issues.createComment(context.issue({ body: comment }))
  }

  commands(robot, 'submit', async (context, command) => {
    if (command.arguments) {
      await addComment(context, '/submit does not take arguments')
      return;
    }

    await instantiate();

    const comment = context.payload.comment;
    if (!comment || !comment.user || !comment.user.login) {
      console.log('Cannot determine user who launched this');
      return;
    }
    const gitHubUser = comment.user.login;

    const issue = context.payload.issue;
    if (!issue || !issue.pull_request || !issue.pull_request.html_url) {
      console.log('No issue/PR/URL found');
      return;
    }
    const pullRequestURL = issue.pull_request.html_url;

    if (!issue.title || !issue.body) {
      console.log('Ignoring PR with empty title and/or body');
      return;
    }
    const description = `${issue.title}\n\n${issue.body}`;

    const repository = context.payload.repository;
    if (!repository || !repository.owner || !repository.owner.login || !repository.name || !issue.number) {
      console.log('Could not determine PR');
    }
    let pr = await context.github.pullRequests.get({
      number: issue.number,
      owner: repository.owner.login,
      repo: repository.name
    });
    if (pr && !pr.base && pr.data && pr.data.base) {
      pr = pr.data;
    }
    if (!pr || !pr.base || !pr.base.label || !pr.base.sha || !pr.head || !pr.head.label || !pr.head.sha) {
      console.log(`Could not determine PR details:\n${JSON.stringify(pr, null, 4)}`);
      return;
    }
    let gitHubUserName = comment.user.name;
    if (!gitHubUserName) {
      let user = await context.github.users.getById({ id: comment.user.id });
      if (user && !user.name && user.data && user.data.name) {
        user = user.data;
      }
      gitHubUserName = user.name;
      if (!gitHubUserName) {
        throw new Error(`Could not determine name of ${gitHubUser}`);
      }
    }

    const baseLabel = pr.base.label;
    const baseCommit = pr.base.sha;
    const headLabel = pr.head.label;
    const headCommit = pr.head.sha;

    try {
      const coverMid = await gitGitGadget.submit(gitHubUser, gitHubUserName, pullRequestURL, description,
        baseLabel, baseCommit, headLabel, headCommit);
      await addComment(context, `Submitted as [${coverMid}](https://public-inbox.org/git/${coverMid})`);
    } catch (reason) {
      await addComment(context, `An error occurred while submitting:\n\n${reason}`);
    }
  })

  commands(robot, 'allow', async (context, command) => {
    const comment = context.payload.comment;
    if (!comment || !comment.user || !comment.user.login) {
      console.log('Cannot determine user who launched this');
      return;
    }
    const gitHubUser = comment.user.login;
    await instantiate()
    try {
      if (await gitGitGadget.allowUser(gitHubUser, command.arguments))
        await addComment(context, `User ${command.arguments} is now allowed to use GitGitGadget.`)
      else
        await addComment(context, `User ${command.arguments} already allowed to use GitGitGadget.`)
    } catch (reason) {
      await addComment(context, `An error occurred while processing:\n\n${reason}`)
    }
  })

  commands(robot, 'disallow', async (context, command) => {
    const comment = context.payload.comment;
    if (!comment || !comment.user || !comment.user.login) {
      console.log('Cannot determine user who launched this');
      return;
    }
    const gitHubUser = comment.user.login;
    await instantiate()
    try {
      if (await gitGitGadget.disallowUser(gitHubUser, command.arguments))
        await addComment(context, `User ${command.arguments} is no longer allowed to use GitGitGadget.`)
      else
        await addComment(context, `User ${command.arguments} already not allowed to use GitGitGadget.`)
    } catch (reason) {
      await addComment(context, `An error occurred while processing:\n\n${reason}`)
    }
  })
}
