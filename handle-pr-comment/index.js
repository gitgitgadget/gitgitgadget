async function run() {
  const { CIHelper } = await import("../dist/index.js")

  const ci = new CIHelper()
  const { owner, comment_id } = ci.parsePRCommentURLInput()

  await ci.setupGitHubAction()
  await ci.handleComment(owner, comment_id)
}

run()
