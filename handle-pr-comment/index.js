async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()
  const { owner, commentId } = ci.parsePRCommentURLInput()

  await ci.setupGitHubAction()
  await ci.handleComment(owner, commentId)
}

run()
