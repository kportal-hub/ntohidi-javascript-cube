const fs = require('fs');
const shell = require("shelljs")
const axios = require("axios");

async function fetchLesson(cube) {
    console.log("Getting Cube Info...");
    try {
        shell.exec(`git checkout master`, {silent: false});
        let cubeInfo = JSON.parse(fs.readFileSync(`${cube}.cube.json`, 'utf8'));
        return cubeInfo;
    } catch (err) {
        throw err
    }
}

async function updateCubeInfo(cube, cHub, repo, token) {
    console.log("Update cube info");
    let silent = false;
    let now = +new Date();
    try {
        shell.exec(`git checkout master`, {silent: false});
        let cubeInfo = JSON.parse(fs.readFileSync(`${cube}.cube.json`, "utf8")) || {};
        // let docsCubeInfo = JSON.parse(fs.readFileSync(`docs/${cube}.cube.json`, "utf8")) || {};
        cubeInfo.completed = now;
        cubeInfo.modified = now;
        // docsCubeInfo.complete = now;
        // docsCubeInfo.modified = now;

        fs.writeFileSync(`${cube}.cube.json`, JSON.stringify(cubeInfo, null, 4));
        // fs.writeFileSync(`docs/${cube}.cube.json`, JSON.stringify(docsCubeInfo, null, 4));

        shell.exec(`git add --all`, { silent });
        shell.exec(`git commit -m 'Complete cube, update Cube info'`, { silent });
        shell.exec(`git push https://${cHub}:${token}@github.com/${repo}.git master`, { silent });
        
        console.log("Done");
        return true;
    } catch (err) {
        throw err
    }
}

async function checkIsDone(cHub, repo, gitToken, branch, isMerged) {
    if (isMerged) {
        console.log("Checking merge request...");
        const server = "https://cubie.now.sh";
        try {
            const studentRepoName = repo.split('/')[1];
            const studentUsername = studentRepoName.split('-')[0];
            const cubeName = studentRepoName.split('-')[1];
            let hasPendingLesson = false;

            let cubeInfo = await fetchLesson(cubeName);
            // let cubeLessons = cubeInfo.lessons;
            let cubeLessons = cubeInfo.result;
            let _key = Object.keys(cubeLessons);
            for (let idx = 0; idx < _key.length; idx++) {
                const l = cubeLessons[_key[idx]];
                if (l['test'] === 'pending') {
                    hasPendingLesson = true;
                }
            }
            if (!hasPendingLesson) {
                // update completed time for cube
                await updateCubeInfo(cubeName, cHub, repo, gitToken);

                // notify trainer
                console.log(`Notify KidoCode and teacher...`);
                let rn = await axios.post(server + "/api/notify", {
                    "username": studentUsername,
                    "repoLink": `https://github.com/${repo}`,
                    "receiver": "nasrin@kidocode.com"
                });
                // console.log(rn.data);
                console.log("Done");
                return true;
            }
            
            console.log(`${studentUsername}/${studentRepoName} cube has more lessons to be completed and certified`);

            return true;

        } catch (err) {
            console.log(err)
            throw err
        }
    }
}

const onMergeLesson = async (repo, gitToken, isMerged, branch) => {
    const cHub = "kportal-hub";
    return await checkIsDone(cHub, repo, gitToken, branch, isMerged)
}

onMergeLesson(process.argv[2], process.argv[3], process.argv[5], process.argv[4]).then((res) => {
    console.log(res)
})
