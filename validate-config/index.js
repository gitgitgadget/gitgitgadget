async function run() {
  const { CIHelper } = await import("../dist/index.js")

  try {
    const config = CIHelper.getConfigAsGitHubActionInput()
    console.log(
      `This is a valid GitGitGadget configuration:\n${JSON.stringify(config, null, 2)}`,
    )
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  }
}

run()
