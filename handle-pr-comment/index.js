async function run() {
  const { CIHelper } = await import("../dist/index.js")

  if (process.env.GITGITGADGET_DEBUG) {
    // Avoid letting VS Code's `GIT_ASKPASS` any push succeed
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith("GIT_") || key.startsWith("VSCODE_")) {
        console.warn(`Deleting environment variable ${key}`)
        delete process.env[key]
      }
    })
    process.env.GIT_CONFIG_NOSYSTEM = "1"
    process.env.GIT_CONFIG_GLOBAL = "does-not-exist"
  }

  const ci = new CIHelper()
  const { owner, commentId } = ci.parsePRCommentURLInput()

  await ci.setupGitHubAction()
  await ci.handleComment(owner, commentId)
}

run()
