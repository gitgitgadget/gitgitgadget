import { Octokit } from "@octokit/rest";

/*
Tool for cleaning up old branches left over from github-helper.test.ts
tests that failed.  The branches are named with a timestamp.  Deleting
branches will close open PRs.  This is primarily intended to be used by
a workflow.  The default is to delete branches older than two days.
*/

// ref level results of the GraphQL query

declare type refGraph = {
    node: {
        // branches as refs
        name: string;
        id: string;
        pulls: {
            edges: [
                // pull requests
                {
                    node: {
                        number: number;
                    };
                },
            ];
        };
    };
};

// repository level results of the GraphQL query

declare type repositoryGraph = {
    repository: {
        refs: {
            edges: refGraph[];
        };
    };
};

/**
 * Options to modify requests.  hours takes precedence over minutes.
 * minutes is primarily for testing.  hours is relative to start of day and
 * minutes is relative to current time.  hours defaults to two days.
 * Refs will not be deleted if dryRun is true.
 *
 * @param hours is how old a branch should be
 * @param minutes is how old a branch should be
 * @param dryRun skip deletion if true
 */
export type deletionOptions = {
    hours?: number;
    minutes?: number;
    dryRun?: boolean;
};

/**
 * @param octocat GitHub connection
 * @param owner userid of repository owner on GitHub
 * @param repo name of repository on GitHub
 * @param options deletionOptions to override default of two days
 */
export async function deleteBranches(
    octocat: Octokit,
    owner: string,
    repo: string,
    options: deletionOptions = {},
): Promise<void> {
    if (!owner || !repo) {
        throw new Error("Missing owner or repo name.");
    }

    const expires = new Date();

    if (!options.hours && !options.minutes) {
        options.hours = 48;
    }

    if (options.hours) {
        expires.setUTCHours(0 - options.hours, 0, 0);
    } else if (options.minutes) {
        expires.setUTCMinutes(expires.getUTCMinutes() - options.minutes);
    } else {
        throw new Error("Invalid options passed.");
    }

    const expireDate = expires.toISOString().replace(/[:.]/g, "_");

    const query = `query {
        repository(name: "${repo}", owner: "${owner}") {
            id,
            name,
            refs(refPrefix: "refs/heads/", first: 10) {
                edges {
                    node {
                        name,
                        id,
                        pulls:associatedPullRequests(first: 5, states:OPEN) {
                            edges {
                                node {
                                    id,
                                    number,
                                    title,
                                }
                            }
                        }
                    }
                }
            }
        }
    }`;

    const result: repositoryGraph = await octocat.graphql(query);

    // console.log(result.repository.refs.edges);

    await Promise.all(
        result.repository.refs.edges.map(async (ref) => {
            const br = ref.node;
            const name = br.name;
            const suffix = name.match(/ggg[_-]test-branch-\S+?[-_](.*)/);

            if (suffix && suffix[1] < expireDate) {
                if (br.pulls.edges.length) {
                    console.log(`Closing PR ${br.pulls.edges[0].node.number}`);
                }
                console.log(`Deleting branch ${br.name}`);
                const mutate = `mutation DeleteBranch {
                    deleteRef(input:{refId: "${br.id}"}) {
                    clientMutationId }}`;
                if (!options.dryRun) {
                    return octocat.graphql(mutate);
                } else {
                    console.log(`Deletion of refId: "${br.id}" skipped`);
                }
            }
        }),
    );
}
