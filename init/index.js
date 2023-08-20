async function run() {
    const { execSync } = await import('child_process')
    const { CIHelper } = await import('../dist/index.js')

    const core = CIHelper.getActionsCore()

    // help dugite realize where `git` is...
    process.env.LOCAL_GIT_DIRECTORY = '/usr/'

    execSync('git init --bare --initial-branch main')
    const ci = new CIHelper('.', await CIHelper.getConfig(), true)

    const gggAppID = core.getInput('gitgitgadget-app-id')
    const gggPrivateKey = core.getInput('gitgitgadget-private-key')
    const gggAppID2 = core.getInput('gitgitgadget-git-app-id')
    const gggPrivateKey2 = core.getInput('gitgitgadget-git-private-key')

    for (const options of [
        {
            name: 'gitgitgadget',
            appID: gggAppID,
            privateKey: gggPrivateKey
        },
        {
            name: 'git',
            appID: gggAppID2,
            privateKey: gggPrivateKey2
        },
        {
            name: 'dscho',
            appID: gggAppID2,
            privateKey: gggPrivateKey2
        }
    ]) {
        const token = await ci.configureGitHubAppToken(options)
        core.setSecret(token)
        core.setOutput(`${options.name}-token`, token)
    }

    // add a reaction
    await ci.github.addReaction('dscho', 'git', 791752382, 'laugh')
}

run()
