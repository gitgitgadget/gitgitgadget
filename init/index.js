async function run() {
  const { CIHelper } = await import("../dist/index.js")

  console.log(`initializing CIHelper`)
  const ci = new CIHelper()
  console.log(`setup`)
  await ci.setupGitHubAction()
  console.log(`setup done`)

  for (const user of ["dscho", "xyz"]) {
    console.log(`user ${user} allowed: ${await ci.isAllowed(user)}`)
  }

  // add a reaction
  const core = CIHelper.getActionsCore()
  const prCommentUrl = core.getInput("pr-comment-url")
  const [, owner, repo, prNumber, commentId] = prCommentUrl.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#issuecomment-(\d+)/,
  )
  if (!owner) {
    throw new Error(`Invalid PR comment URL: ${prCommentUrl}`)
  }
  const reaction = core.getInput("reaction")
  await ci.github.addReaction(owner, repo, commentId, reaction)
}

run()
